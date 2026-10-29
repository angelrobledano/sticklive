/**
 * 097 — los pseudo-equipos «DESCANSO 1/2» que entraron como equipos (y club)
 * se borran con su fila de bye, sin tocar a los equipos reales.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { db, closeDb } from '@sports/db';
import { limpiar } from './support/db.js';
import { crearPartido, crearEquipo } from './support/factorias.js';

const SQL = readFileSync(fileURLToPath(new URL('../../packages/db/migrations/097_purge_bye_teams.sql', import.meta.url)), 'utf8');

beforeEach(limpiar);
afterAll(closeDb);

describe('097 — purga de equipos de descanso', () => {
  it('borra el equipo, su partido de bye, la inscripción y el club huérfano; deja lo real', async () => {
    const p = await crearPartido();
    const { rows: [club] } = await db.query<{ id: string }>(
      `INSERT INTO clubs (sport_id, canonical_name, slug) VALUES ($1, 'DESCANSO 1', 'descanso-1') RETURNING id`, [p.sportId]);
    const bye = await crearEquipo(p.sportId, 'DESCANSO 1');
    await db.query(`UPDATE teams SET club_id = $1 WHERE id = $2`, [club!.id, bye]);
    await db.query(`INSERT INTO season_teams (season_id, team_id) VALUES ($1, $2)`, [p.seasonId, bye]);
    const byeMatch = (await db.query<{ id: string }>(
      `INSERT INTO matches (season_id, home_team_id, away_team_id, status, scheduled_at, source_ref)
       VALUES ($1, $2, $3, 'scheduled', NOW(), 'fep_match_bye') RETURNING id`, [p.seasonId, p.homeTeamId, bye])).rows[0]!.id;

    await db.query(SQL);
    await db.query(SQL); // idempotente

    const count = async (sql: string, args: unknown[]) => (await db.query(sql, args)).rowCount;
    expect(await count(`SELECT 1 FROM teams WHERE id = $1`, [bye])).toBe(0);
    expect(await count(`SELECT 1 FROM matches WHERE id = $1`, [byeMatch])).toBe(0);
    expect(await count(`SELECT 1 FROM clubs WHERE id = $1`, [club!.id])).toBe(0);
    expect(await count(`SELECT 1 FROM matches WHERE id = $1`, [p.matchId])).toBe(1);
    expect(await count(`SELECT 1 FROM teams WHERE id = ANY($1)`, [[p.homeTeamId, p.awayTeamId]])).toBe(2);
  });
});
