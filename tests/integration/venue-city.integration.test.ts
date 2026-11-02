/**
 * Ciudad del pabellón desde el club local (2/11/2026), para el marcado de
 * eventos de Google. Solo cuando el pabellón es la pista de casa del equipo.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { db, closeDb, fillVenueCity } from '@sports/db';
import { limpiar } from './support/db.js';
import { crearPartido } from './support/factorias.js';

beforeEach(async () => { await limpiar(); });
afterAll(async () => { await closeDb(); });

const ciudad = async (id: string) =>
  (await db.query<{ venue_city: string | null }>(`SELECT venue_city FROM matches WHERE id = $1`, [id])).rows[0]!.venue_city;

describe('fillVenueCity', () => {
  it('el nombre del pabellón contiene la ciudad del equipo local', async () => {
    const p = await crearPartido();
    await db.query(`UPDATE teams SET city = 'Reus' WHERE id = $1`, [p.homeTeamId]);
    await db.query(`UPDATE matches SET venue_name = 'PALAU D''ESPORTS DE REUS' WHERE id = $1`, [p.matchId]);
    expect(await fillVenueCity()).toBe(1);
    expect(await ciudad(p.matchId)).toBe('Reus');
  });

  it('pista de casa habitual (2 partidos como local ahí) aunque el nombre no diga la ciudad', async () => {
    const p = await crearPartido();
    await db.query(`UPDATE teams SET city = 'A Coruña' WHERE id = $1`, [p.homeTeamId]);
    const otro = await crearPartido({ seasonId: p.seasonId });
    await db.query(`UPDATE matches SET home_team_id = $1, venue_name = 'PALACIO DE LOS DEPORTES DE RIAZOR' WHERE id IN ($2, $3)`,
      [p.homeTeamId, p.matchId, otro.matchId]);
    await fillVenueCity();
    expect(await ciudad(p.matchId)).toBe('A Coruña');
  });

  it('sede neutral (una sola vez, sin la ciudad en el nombre): sin ciudad', async () => {
    const p = await crearPartido();
    await db.query(`UPDATE teams SET city = 'Reus' WHERE id = $1`, [p.homeTeamId]);
    await db.query(`UPDATE matches SET venue_name = 'PAVELLÓ MUNICIPAL DE MANLLEU' WHERE id = $1`, [p.matchId]);
    expect(await fillVenueCity()).toBe(0);
    expect(await ciudad(p.matchId)).toBeNull();
  });
});
