import { beforeEach, describe, expect, it, vi } from 'vitest';

// push-dispatcher arrastra web-push/@sentry y, vía push-expo, @sports/db: los
// tests unitarios del ETL corren SIN base de datos ni red (patrón de
// push-expo.test.ts) — módulos mockeados y fetch stub. @sports/analytics se
// mockea para que `captureSent` del dispatcher sea hermético (sin key el
// módulo real lanza al importar).
const logFns = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
const dbQuery = vi.hoisted(() =>
  vi.fn(async (_sql?: string, _args?: unknown[]) => ({ rows: [] as unknown[] })),
);
vi.mock('@sports/db', () => ({ db: { query: dbQuery } }));
vi.mock('@sports/logger', () => ({ createLogger: () => logFns }));
vi.mock('@sports/analytics', () => ({
  analytics: { capture: vi.fn() },
  shutdownAnalytics: vi.fn(async () => {}),
}));

import {
  deliverNativeMorningSummaries,
  groupMorningByPayload,
  type NightFinal,
} from './push-dispatcher.js';
import type { NativeSubRow } from './push-expo.js';

function mkNative(i: number): NativeSubRow {
  return {
    id: `sub-${i}`,
    expo_push_token: `token-${i}`,
    device_id: `dev-${i}`,
    fav_teams: ['T1'], fav_leagues: [], fav_players: [],
    config: {}, presets: {},
  };
}

/** Final nocturno candidato al resumen (todos los subs siguen 'T1'). */
const FINAL: NightFinal = {
  matchId: 'm1', homeTeamId: 'T1', awayTeamId: 'T2', competitionId: 'C1',
  homeShort: 'BAR', awayShort: 'IHC', homeScore: 2, awayScore: 1, kickoffLocal: '23:15',
};

/** Respuesta HTTP mínima para el fetch stub (solo se lee ok/json). */
function jsonRes(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

const fetchMock = vi.hoisted(() => vi.fn());

beforeEach(() => {
  fetchMock.mockReset();
  dbQuery.mockReset();
  dbQuery.mockImplementation(async () => ({ rows: [] }));
  logFns.info.mockClear();
  logFns.warn.mockClear();
  logFns.error.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});

describe('groupMorningByPayload — agrupa pendientes por CONTENIDO del resumen', () => {
  it('subs con los mismos partidos comparten grupo; contenido distinto, grupos distintos', () => {
    const other = { ...FINAL, matchId: 'm2', homeScore: 0, awayScore: 0 };
    const groups = groupMorningByPayload([
      { sub: mkNative(1), matches: [FINAL] },
      { sub: mkNative(2), matches: [FINAL] },
      { sub: mkNative(3), matches: [other] },
    ]);
    expect(groups).toHaveLength(2);
    const mismoResumen = groups.find((g) => g.matches[0]!.matchId === 'm1')!;
    expect(mismoResumen.subs.map((s) => s.id)).toEqual(['sub-1', 'sub-2']);
  });

  it('la clave cubre marcador y kickoff (entran en el copy), no solo los ids', () => {
    const otroMarcador = { ...FINAL, homeScore: 3, kickoffLocal: '23:40' };
    expect(groupMorningByPayload([
      { sub: mkNative(1), matches: [FINAL] },
      { sub: mkNative(2), matches: [otroMarcador] },
    ])).toHaveLength(2);
  });
});

describe('deliverNativeMorningSummaries — lote troceado con ledger por ticket', () => {
  it('250 subs → 3 POSTs a /push/send (100/100/50) y ledger SOLO de los tickets ok (mezcla ok/error)', async () => {
    const subs = Array.from({ length: 250 }, (_, i) => mkNative(i));
    const marked: Array<[string, string]> = []; // (subscription_id, day) del INSERT
    dbQuery.mockImplementation(async (sql?: string, args?: unknown[]) => {
      const s = String(sql);
      if (s.includes('FROM push_summary_log WHERE day')) return { rows: [] };
      if (s.includes('INSERT INTO push_summary_log')) {
        marked.push([String(args?.[0]), String(args?.[1])]);
        return { rows: [] };
      }
      return { rows: [] };
    });
    fetchMock.mockImplementation(async (url: unknown, init?: { body?: unknown }) => {
      if (String(url).includes('/push/getReceipts')) return jsonRes({ data: {} });
      const chunk = JSON.parse(String(init?.body)) as Array<{ to: string }>;
      const start = Number(chunk[0]!.to.split('-')[1]);
      return jsonRes({
        data: chunk.map((_m, j) => {
          const idx = start + j;
          return idx === 1 || idx === 150
            ? { status: 'error', message: 'rechazado' }
            : { id: `r${idx}`, status: 'ok' };
        }),
      });
    });

    await deliverNativeMorningSummaries(subs, [FINAL], '2026-06-23', 'sum:2026-06-23');

    // TODO el lote en 3 llamadas troceadas a 100 — no un POST por suscripción.
    const sendCalls = fetchMock.mock.calls.filter(([u]) => String(u).includes('/push/send'));
    expect(sendCalls).toHaveLength(3);
    expect(sendCalls.map((c) => (JSON.parse(String(c[1]?.body)) as unknown[]).length))
      .toEqual([100, 100, 50]);

    // El ledger consultado/escrito es EXCLUSIVAMENTE del canal nativo.
    expect(String(dbQuery.mock.calls[0]![0])).toContain("channel = 'native'");
    // Solo los tickets ok se marcan (subs 1 y 150 fallaron: sin INSERT).
    expect(marked).toHaveLength(248);
    expect(marked.some(([id]) => id === 'sub-1')).toBe(false);
    expect(marked.some(([id]) => id === 'sub-150')).toBe(false);
    expect(marked.some(([id]) => id === 'sub-0')).toBe(true);
    expect(marked.every(([, day]) => day === '2026-06-23')).toBe(true);
    // Recuento explícito en el log (ledger INSERT antes de contar).
    expect(logFns.info).toHaveBeenCalledWith(
      expect.objectContaining({ pending: 250, nativeSent: 248, nativeFailed: 2 }),
      '🌅 Resumen matinal (nativo)',
    );
  });

  it('un lote rechazado por Expo (HTTP no-ok) no marca a esas subs y no bloquea al resto', async () => {
    const subs = Array.from({ length: 250 }, (_, i) => mkNative(i));
    const marked: string[] = [];
    dbQuery.mockImplementation(async (sql?: string, args?: unknown[]) => {
      const s = String(sql);
      if (s.includes('FROM push_summary_log WHERE day')) return { rows: [] };
      if (s.includes('INSERT INTO push_summary_log')) {
        marked.push(String(args?.[0]));
        return { rows: [] };
      }
      return { rows: [] };
    });
    let sendCall = 0;
    fetchMock.mockImplementation(async (url: unknown, init?: { body?: unknown }) => {
      if (String(url).includes('/push/getReceipts')) return jsonRes({ data: {} });
      sendCall++;
      if (sendCall === 2) return { ok: false, status: 429 } as unknown as Response;
      const chunk = JSON.parse(String(init?.body)) as Array<{ to: string }>;
      const start = Number(chunk[0]!.to.split('-')[1]);
      return jsonRes({ data: chunk.map((_m, j) => ({ id: `r${start + j}`, status: 'ok' })) });
    });

    await deliverNativeMorningSummaries(subs, [FINAL], '2026-06-23', 'sum');

    // Chunks 1 y 3 ok (subs 0-99 y 200-249) → 150 marcados; el chunk 2 entero
    // (subs 100-199) queda SIN marcar: se reintentará la próxima invocación.
    expect(marked).toHaveLength(150);
    expect(marked.some((id) => id === 'sub-100')).toBe(false);
    expect(marked.some((id) => id === 'sub-199')).toBe(false);
    expect(marked.some((id) => id === 'sub-0')).toBe(true);
    expect(marked.some((id) => id === 'sub-249')).toBe(true);
  });

  it('sin pendientes (todo ya en el ledger) no llama a Expo', async () => {
    dbQuery.mockImplementation(async (sql?: string) => {
      if (String(sql).includes('FROM push_summary_log WHERE day')) {
        return { rows: [{ subscription_id: 'sub-1' }] };
      }
      return { rows: [] };
    });
    await deliverNativeMorningSummaries([mkNative(1)], [FINAL], '2026-06-23', 'sum');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
