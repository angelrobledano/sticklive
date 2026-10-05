/**
 * #226 — Reconciliación de clasificaciones con los partidos de su temporada.
 *
 * La auditoría de integridad (2026-09-27) encontró que solo 323/2.414 filas de
 * standings cuadraban con los partidos de su temporada. Esta es la guarda que lo
 * detecta: recalcula PJ/V/E/D/GF/GC desde los `finished` y compara (sin puntos,
 * que llevan deducciones ajenas a este cálculo).
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { db, closeDb } from '@sports/db';
import { limpiar } from './support/db.js';
import { crearPartido } from './support/factorias.js';
import { countStandingsMismatches } from '../../apps/etl/src/standings-reconcile.js';

beforeEach(async () => {
  await limpiar();
});

afterAll(async () => {
  await closeDb();
});

interface Filas { played: number; won: number; drawn: number; lost: number; gf: number; ga: number }

async function standing(seasonId: string, teamId: string, s: Filas) {
  await db.query(
    `INSERT INTO standings (season_id, team_id, played, won, drawn, lost, goals_for, goals_against)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [seasonId, teamId, s.played, s.won, s.drawn, s.lost, s.gf, s.ga]);
}

describe('standings-reconcile (#226)', () => {
  it('no cuenta nada cuando la clasificación cuadra con los partidos', async () => {
    const { seasonId, homeTeamId, awayTeamId, matchId } = await crearPartido({ status: 'finished' });
    await db.query(`UPDATE matches SET home_score = 3, away_score = 1 WHERE id = $1`, [matchId]);
    await standing(seasonId, homeTeamId, { played: 1, won: 1, drawn: 0, lost: 0, gf: 3, ga: 1 });
    await standing(seasonId, awayTeamId, { played: 1, won: 0, drawn: 0, lost: 1, gf: 1, ga: 3 });

    expect(await countStandingsMismatches()).toBe(0);
  });

  it('cuenta la fila que no reconcilia (GF/GC o PJ)', async () => {
    const { seasonId, homeTeamId, awayTeamId, matchId } = await crearPartido({ status: 'finished' });
    await db.query(`UPDATE matches SET home_score = 3, away_score = 1 WHERE id = $1`, [matchId]);
    await standing(seasonId, homeTeamId, { played: 1, won: 1, drawn: 0, lost: 0, gf: 3, ga: 1 }); // ok
    await standing(seasonId, awayTeamId, { played: 1, won: 0, drawn: 0, lost: 1, gf: 9, ga: 9 }); // mal

    expect(await countStandingsMismatches()).toBe(1);
  });

  it('con lote, solo mira las temporadas de ese lote', async () => {
    // Temporada DEL lote: clasificación correcta.
    const inBatch = await crearPartido({ status: 'finished' });
    await db.query(`UPDATE matches SET home_score = 1, away_score = 0 WHERE id = $1`, [inBatch.matchId]);
    const batchId = '00000000-0000-0000-0000-0000000b9b9b';
    await db.query(`INSERT INTO import_batches (id, label, kind, status) VALUES ($1,'sr-test','manual','completed')`, [batchId]);
    await db.query(`UPDATE matches SET import_batch_id = $1 WHERE id = $2`, [batchId, inBatch.matchId]);
    await standing(inBatch.seasonId, inBatch.homeTeamId, { played: 1, won: 1, drawn: 0, lost: 0, gf: 1, ga: 0 });
    await standing(inBatch.seasonId, inBatch.awayTeamId, { played: 1, won: 0, drawn: 0, lost: 1, gf: 0, ga: 1 });

    // Otra temporada FUERA del lote, con clasificación incoherente.
    const outside = await crearPartido({ status: 'finished' });
    await db.query(`UPDATE matches SET home_score = 2, away_score = 2 WHERE id = $1`, [outside.matchId]);
    await standing(outside.seasonId, outside.homeTeamId, { played: 5, won: 5, drawn: 0, lost: 0, gf: 99, ga: 0 });

    expect(await countStandingsMismatches(null)).toBe(1);      // global: la de fuera
    expect(await countStandingsMismatches(batchId)).toBe(0);   // acotado al lote: ninguna
  });
});
