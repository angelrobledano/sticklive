/**
 * Placeholders sintéticos duplicados (caso real WSG femenino, 10/10/2026): la
 * corrección de la zona horaria de Asunción (UTC-4 → UTC-3) cambió la hora de
 * los partidos aún sin idp y, como la ref sintética incluye la hora, quedaron
 * dos filas por partido (la vieja una hora más tarde). El cuadro enseñaba el
 * partido equivocado. World Skate reconcilia ahora tras cada carga, acotado a
 * su temporada.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { db, closeDb, reconcileSyntheticMatches } from '@sports/db';
import { limpiar } from './support/db.js';
import { crearDeporte, crearCompeticion, crearTemporada, crearEquipo } from './support/factorias.js';

beforeEach(limpiar);
afterAll(closeDb);

async function sintetico(seasonId: string, home: string, away: string, at: string, scrapedAt: string) {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO matches (season_id, home_team_id, away_team_id, status, scheduled_at, scraped_at, source_ref)
     VALUES ($1,$2,$3,'scheduled',$4,$5,$6) RETURNING id`,
    [seasonId, home, away, at, scrapedAt, `synthetic:${seasonId}:${home}:${away}:${at}`]);
  return rows[0]!.id;
}

describe('reconcileSyntheticMatches', () => {
  it('quita el sintético viejo (hora antigua) y deja el actual; acotado a la temporada pedida', async () => {
    const sport = await crearDeporte();
    const fem = await crearTemporada(await crearCompeticion(sport));
    const otra = await crearTemporada(await crearCompeticion(sport));
    const [arg, esp] = await Promise.all([crearEquipo(sport, 'ARG'), crearEquipo(sport, 'ESP')]);

    // Final ARG-ESP: 20:00 en Asunción. Vieja con UTC-4 (00:00Z), nueva con UTC-3 (23:00Z).
    const vieja = await sintetico(fem, arg, esp, '2026-10-11T00:00:00Z', '2026-10-09T12:00:00Z');
    const nueva = await sintetico(fem, arg, esp, '2026-10-10T23:00:00Z', '2026-10-10T17:45:00Z');
    const otraVieja = await sintetico(otra, arg, esp, '2026-10-11T00:00:00Z', '2026-10-09T12:00:00Z');
    await sintetico(otra, arg, esp, '2026-10-10T23:00:00Z', '2026-10-10T17:45:00Z');

    expect(await reconcileSyntheticMatches(fem)).toBe(1);
    const quedan = await db.query<{ id: string }>(`SELECT id FROM matches WHERE season_id = $1`, [fem]);
    expect(quedan.rows.map((r) => r.id)).toEqual([nueva]);
    expect(quedan.rows.map((r) => r.id)).not.toContain(vieja);

    // La otra temporada no se toca con la llamada acotada…
    const otras = await db.query(`SELECT id FROM matches WHERE season_id = $1`, [otra]);
    expect(otras.rowCount).toBe(2);
    // …y la llamada global (calendario FEP) sigue limpiando todo.
    expect(await reconcileSyntheticMatches()).toBe(1);
    const otrasDespues = await db.query<{ id: string }>(`SELECT id FROM matches WHERE season_id = $1`, [otra]);
    expect(otrasDespues.rows.map((r) => r.id)).not.toContain(otraVieja);
  });
});
