/**
 * Chequeos diarios de calidad del dato de ESTRUCTURA y DIRECTO (integrity-check,
 * checks 8-13) contra Postgres real: cada anomalía sembrada debe salir, y una
 * temporada sana no debe dar ninguna.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { db, closeDb, ensurePhase } from '@sports/db';
import { limpiar } from './support/db.js';
import { crearDeporte, crearCompeticion, crearTemporada, crearEquipo, crearFuente } from './support/factorias.js';
import {
  checkEstructuraFallback, checkEstructuraSinAdoptar, checkPartidosSinFase,
  checkProgramadosVencidos, checkFinalizadosSinMarcador, checkLiveAtascado,
} from '../../apps/etl/src/integrity-structure.js';

let seasonId: string;
let competitionId: string;
let a: string;
let b: string;
let n = 0;

async function partido(over: { status?: string; scheduledAt?: string; startedAt?: string | null; home?: number | null; away?: number | null; phaseId?: string | null } = {}) {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO matches (season_id, home_team_id, away_team_id, status, scheduled_at, started_at, home_score, away_score, phase_id, source_ref)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [seasonId, a, b, over.status ?? 'scheduled', over.scheduledAt ?? new Date(Date.now() + 86_400_000).toISOString(),
      over.startedAt ?? null, over.home ?? null, over.away ?? null, over.phaseId ?? null, `fep_match_q${++n}`],
  );
  return rows[0]!.id;
}

async function fase(resolvedBy: 'source_rounds' | 'fallback' | 'legacy' = 'source_rounds') {
  if (resolvedBy === 'legacy') {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO phases (season_id, ordinal, kind, resolved_by) VALUES ($1, 1, 'league', 'legacy') RETURNING id`, [seasonId]);
    return rows[0]!.id;
  }
  return ensurePhase({ seasonId, sourceRef: `fep_fase_${++n}`, kind: 'league', isPlacement: false, name: null, ordinal: 1, resolvedBy });
}

beforeEach(async () => {
  await limpiar();
  const sportId = await crearDeporte();
  competitionId = await crearCompeticion(sportId);
  seasonId = await crearTemporada(competitionId, { esActual: true });
  [a, b] = await Promise.all([crearEquipo(sportId, 'Local'), crearEquipo(sportId, 'Visitante')]);
  const sourceId = await crearFuente();
  await db.query(
    `INSERT INTO competition_sources (competition_id, source_id, external_ids, is_active) VALUES ($1,$2,'{"idc":"1"}',TRUE)`,
    [competitionId, sourceId]);
});

afterAll(closeDb);

describe('integridad — estructura y directo', () => {
  it('temporada sana: ningún check salta', async () => {
    const p = await fase();
    await partido({ phaseId: p });
    await partido({ phaseId: p, status: 'finished', scheduledAt: '2026-01-01T18:00:00Z', home: 3, away: 1 });
    for (const c of [checkEstructuraFallback, checkEstructuraSinAdoptar, checkPartidosSinFase,
      checkProgramadosVencidos, checkFinalizadosSinMarcador, checkLiveAtascado]) {
      expect((await c()).violations).toBe(0);
    }
  });

  it('fase resuelta por fallback (la fuente no dejó claro el formato)', async () => {
    await fase('fallback');
    expect((await checkEstructuraFallback()).violations).toBe(1);
  });

  it('temporada en curso con fuente activa que sigue con fases heredadas (el cron no la ha re-estructurado)', async () => {
    await fase('legacy');
    expect((await checkEstructuraSinAdoptar()).violations).toBe(1);
    await db.query(`UPDATE competition_sources SET is_active = FALSE WHERE competition_id = $1`, [competitionId]);
    expect((await checkEstructuraSinAdoptar()).violations).toBe(0);
  });

  it('partidos de la temporada en curso sin fase', async () => {
    await partido();
    expect((await checkPartidosSinFase()).violations).toBe(1);
  });

  it('programado con la hora pasada hace más de 24 h (en la web, «Sin resultado»)', async () => {
    const p = await fase();
    await partido({ phaseId: p, scheduledAt: new Date(Date.now() - 30 * 3_600_000).toISOString() });
    await partido({ phaseId: p, scheduledAt: new Date(Date.now() - 2 * 3_600_000).toISOString() }); // aún «Pendiente»
    expect((await checkProgramadosVencidos()).violations).toBe(1);
  });

  it('terminado sin marcador', async () => {
    const p = await fase();
    await partido({ phaseId: p, status: 'finished', scheduledAt: '2026-01-01T18:00:00Z' });
    expect((await checkFinalizadosSinMarcador()).violations).toBe(1);
  });

  it('en directo más allá del umbral del vigilante, contado desde el saque real', async () => {
    const p = await fase();
    const hace = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
    await partido({ phaseId: p, status: 'live', scheduledAt: hace(9), startedAt: hace(8) });
    await partido({ phaseId: p, status: 'live', scheduledAt: hace(9), startedAt: hace(1) }); // empezó tarde: legítimo
    expect((await checkLiveAtascado()).violations).toBe(1);
  });
});
