import { beforeEach, describe, expect, it, vi } from 'vitest';
import { chunkMessages, deliverNative, toExpoMessage } from './push-expo.js';

// push-expo importa @sports/db (loadNativeSubs/processReceipts/pruneDeadTokens):
// los tests unitarios del ETL corren SIN base de datos (CI `quality` no define
// DATABASE_URL), así que se mockean el módulo completo — con handles para poder
// asertar los DELETE de poda — y el logger, para asertar los warn explícitos.
// La I/O contra Expo Push se mockea con fetch stub (el envío real con token es
// verificación humana, plan Task 4.3 Step 5).
const logFns = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
const dbQuery = vi.hoisted(() => vi.fn(async () => ({ rows: [] })));
vi.mock('@sports/db', () => ({ db: { query: dbQuery } }));
vi.mock('@sports/logger', () => ({ createLogger: () => logFns }));

const PAYLOAD = {
  title: 'GOL',
  body: 'A 1-0 B',
  tag: 'match:1',
  url: 'https://sticklive.eu/matches/1',
  type: 'goal',
} as const;

function mkSub(i: number) {
  return {
    id: `sub-${i}`,
    expo_push_token: `token-${i}`,
    device_id: `dev-${i}`,
    fav_teams: [], fav_leagues: [], fav_players: [],
    config: {}, presets: {},
  };
}

/** Respuesta HTTP mínima para el fetch stub (deliverNative solo lee ok/json). */
function jsonRes(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

const fetchMock = vi.hoisted(() => vi.fn());

beforeEach(() => {
  fetchMock.mockReset();
  dbQuery.mockClear();
  logFns.info.mockClear();
  logFns.warn.mockClear();
  logFns.error.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});

describe('toExpoMessage', () => {
  it('mapea el payload web al mensaje de Expo Push con canal de gol a favor, collapseId y TTL 1h', () => {
    const msg = toExpoMessage(
      { id: 'tok-1', expo_push_token: 'ExponentPushToken[abc]', fav_teams: ['team-barca'] } as never,
      { ...PAYLOAD, scorerTeamId: 'team-barca', opponentTeamId: 'team-liceo' },
    );
    expect(msg).toMatchObject({
      to: 'ExponentPushToken[abc]',
      title: 'GOL',
      body: 'A 1-0 B',
      channelId: 'sticklive_goals_fav_v1',
      sound: 'gol_favor.wav',
      ttl: 3600, // paridad con el TTL del canal web: un gol tardío no interesa
      collapseId: 'match:1',
      data: { type: 'goal', urlPath: '/match/1' },
    });
  });

  it('mapea a gol en contra cuando el usuario sigue al rival', () => {
    const msg = toExpoMessage(
      { id: 'tok-1', expo_push_token: 'ExponentPushToken[abc]', fav_teams: ['team-liceo'] } as never,
      { ...PAYLOAD, scorerTeamId: 'team-barca', opponentTeamId: 'team-liceo' },
    );
    expect(msg).toMatchObject({
      channelId: 'sticklive_goals_against_v1',
      sound: 'gol_contra.wav',
    });
  });

  it('asigna canal de inicio para eventos start o jornada_start', () => {
    const msg = toExpoMessage(
      { expo_push_token: 'ExponentPushToken[abc]' },
      { ...PAYLOAD, type: 'start' },
    );
    expect(msg).toMatchObject({
      channelId: 'sticklive_match_start_v1',
      sound: 'partido_inicio.wav',
    });
  });

  it('asigna canal de final para eventos final, overtime o penalties', () => {
    const msg = toExpoMessage(
      { expo_push_token: 'ExponentPushToken[abc]' },
      { ...PAYLOAD, type: 'final' },
    );
    expect(msg).toMatchObject({
      channelId: 'sticklive_match_final_v1',
      sound: 'partido_final.wav',
    });
  });

  it('permite override explícito de canal y sonido', () => {
    const msg = toExpoMessage(
      { expo_push_token: 'ExponentPushToken[abc]' },
      { ...PAYLOAD, channelId: 'live', sound: 'default' },
    );
    expect(msg).toMatchObject({
      channelId: 'live',
      sound: 'default',
    });
  });

  it('una URL que no es ficha de partido cae a la ruta raíz ("/")', () => {
    const msg = toExpoMessage(
      { expo_push_token: 'ExponentPushToken[abc]' },
      { title: 'Jornada', body: '', tag: 'round:1', url: 'https://sticklive.eu/', type: 'jornada_start' },
    );
    expect(msg.data).toEqual({ type: 'jornada_start', urlPath: '/' });
  });

  it('quita el prefijo [Stick Live] del título nativo (el sistema ya nombra la app)', () => {
    const msg = toExpoMessage(
      { expo_push_token: 'ExponentPushToken[abc]' },
      { ...PAYLOAD, title: '[Stick Live] 🏑 ¡Gol de Jordi Puig!' },
    );
    expect(msg.title).toBe('🏑 ¡Gol de Jordi Puig!');
  });
});

describe('chunkMessages', () => {
  it('trocea a 100 (límite del API de Expo)', () => {
    const msgs = Array.from({ length: 250 }, (_, i) => ({ to: `t${i}` }));
    expect(chunkMessages(msgs).map((c) => c.length)).toEqual([100, 100, 50]);
  });
});

describe('deliverNative', () => {
  it('poda el token cuyo RECIBO marca DeviceNotRegistered (mapeo recibo→token)', async () => {
    // Dos envíos aceptados; después, el recibo de r2 revela el token muerto.
    fetchMock
      .mockResolvedValueOnce(jsonRes({ data: [{ id: 'r1', status: 'ok' }, { id: 'r2', status: 'ok' }] }))
      .mockResolvedValueOnce(jsonRes({
        data: {
          r1: { status: 'ok' },
          r2: { status: 'error', message: 'The credentials provided were invalid.', details: { error: 'DeviceNotRegistered' } },
        },
      }));

    const res = await deliverNative([mkSub(1), mkSub(2)], { ...PAYLOAD }, vi.fn());

    expect(res).toEqual({ sent: 2, failed: 0 });
    // El DELETE poda el TOKEN del recibo, nunca el id de recibo (regresión del
    // mapa receiptTokens: sin él se borraría la fila equivocada o ninguna).
    expect(dbQuery).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM push_tokens'),
      [['token-2']],
    );
    expect(logFns.info).toHaveBeenCalledWith(
      expect.objectContaining({ pruned: 1 }),
      'Tokens nativos podados (DeviceNotRegistered)',
    );
  });

  it('poda DE INMEDIATO el token cuyo envío por-item marca DeviceNotRegistered', async () => {
    // Expo puede marcar el error en la propia respuesta del envío (sin recibo):
    // la poda no debe esperar a /push/getReceipts.
    fetchMock
      .mockResolvedValueOnce(jsonRes({
        data: [
          { status: 'ok', id: 'r1' },
          { status: 'error', message: 'no longer valid', details: { error: 'DeviceNotRegistered' } },
        ],
      }))
      .mockResolvedValueOnce(jsonRes({ data: { r1: { status: 'ok' } } })); // recibos del aceptado

    const res = await deliverNative([mkSub(1), mkSub(2)], { ...PAYLOAD }, vi.fn());

    expect(res).toEqual({ sent: 1, failed: 1 });
    expect(dbQuery).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM push_tokens'),
      [['token-2']],
    );
    // El rechazo queda logueado con el motivo (nunca silencioso).
    expect(logFns.warn).toHaveBeenCalledWith(
      expect.objectContaining({ deviceId: 'dev-2', detail: 'no longer valid' }),
      'Envío Expo rechazado',
    );
  });

  it('indexa los mensajes por chunk: el recibo del mensaje 150 poda el token 150', async () => {
    // Regresión del índice cruzado (ci * SEND_CHUNK + i): con 250 subs en 3
    // chunks, si el índice no multiplicara por el tamaño de chunk, r150
    // mapearía a un token del primer bloque (0–99) y la poda sería errónea.
    const subs = Array.from({ length: 250 }, (_, i) => mkSub(i));
    fetchMock.mockImplementation(async (_url: unknown, init?: { body?: unknown }) => {
      const body = JSON.parse(String(init?.body)) as unknown;
      if (Array.isArray(body)) {
        // /push/send: body = array de mensajes; ids en orden dentro del chunk.
        const start = Number(String((body[0] as { to: string }).to).split('-')[1]);
        return jsonRes({
          data: body.map((_m: unknown, i: number) => ({ id: `r${start + i}`, status: 'ok' })),
        });
      }
      // /push/getReceipts: body = { ids }; solo r150 está muerto.
      const ids = (body as { ids: string[] }).ids;
      return jsonRes({
        data: Object.fromEntries(ids.map((id) => [id, id === 'r150'
          ? { status: 'error', details: { error: 'DeviceNotRegistered' } }
          : { status: 'ok' }])),
      });
    });

    const res = await deliverNative(subs, { ...PAYLOAD }, vi.fn());

    expect(res).toEqual({ sent: 250, failed: 0 });
    expect(dbQuery).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM push_tokens'),
      [['token-150']],
    );
  });

  it('loguea los errores top-level del lote y no rompe el envío', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonRes({
        errors: [{ code: 'PUSH_TOO_MANY_EXPERIENCE_IDS', message: 'too many ids' }],
        data: [{ status: 'ok', id: 'r1' }],
      }))
      .mockResolvedValueOnce(jsonRes({ data: { r1: { status: 'ok' } } }));

    const res = await deliverNative([mkSub(1)], { ...PAYLOAD }, vi.fn());

    expect(res).toEqual({ sent: 1, failed: 0 });
    expect(logFns.warn).toHaveBeenCalledWith(
      expect.objectContaining({ errors: [{ code: 'PUSH_TOO_MANY_EXPERIENCE_IDS', message: 'too many ids' }] }),
      'Expo Push API devolvió errores top-level',
    );
  });

  it('cuenta como fallidos los mensajes no cubiertos cuando expo responde con errors', async () => {
    // Lote de 3; la respuesta trae errors top-level y SOLO 1 item en data:
    // los 2 mensajes sin respuesta no pueden perderse del recuento.
    fetchMock
      .mockResolvedValueOnce(jsonRes({
        errors: [{ code: 'PUSH_TOO_MANY_EXPERIENCE_IDS', message: 'too many ids' }],
        data: [{ status: 'ok', id: 'r1' }],
      }))
      .mockResolvedValueOnce(jsonRes({ data: { r1: { status: 'ok' } } }));

    const res = await deliverNative([mkSub(1), mkSub(2), mkSub(3)], { ...PAYLOAD }, vi.fn());

    expect(res).toEqual({ sent: 1, failed: 2 });
  });

  it('un fallo de BD en la poda por ticket NO pierde el ciclo (warn y sigue con recibos)', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonRes({
        data: [{ status: 'error', details: { error: 'DeviceNotRegistered' } }],
      }))
      .mockResolvedValueOnce(jsonRes({ data: {} })); // no habría recibos, pero por si acaso
    dbQuery.mockRejectedValueOnce(new Error('db down'));

    const res = await deliverNative([mkSub(1)], { ...PAYLOAD }, vi.fn());

    expect(res).toEqual({ sent: 0, failed: 1 });
    expect(logFns.warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      'Poda por ticket falló — se reintentará con el próximo envío',
    );
  });
});
