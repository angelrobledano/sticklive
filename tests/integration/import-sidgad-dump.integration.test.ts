/**
 * Importación del volcado de la RFEP (sin peticiones).
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { db, closeDb } from '@sports/db';
import { limpiar } from './support/db.js';
import { crearDeporte } from './support/factorias.js';
import { importPlayers, importMatches, renderReport, niceNationality } from '../../apps/etl/src/import-sidgad-dump.js';

beforeEach(async () => { await limpiar(); });
afterAll(async () => { await closeDb(); });

async function jugador(ref: string, last: string, extra: Record<string, string | null> = {}): Promise<string> {
  const sportId = (await db.query<{ id: string }>(`SELECT id FROM sports LIMIT 1`)).rows[0]?.id ?? await crearDeporte();
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO players (sport_id, first_name, last_name, slug, source_ref, nationality, photo_url)
     VALUES ($1, 'Nombre', $2, $3, $4, $5, $6) RETURNING id`,
    [sportId, last, `p-${ref}`, ref, extra['nationality'] ?? null, extra['photo_url'] ?? null],
  );
  return rows[0]!.id;
}

describe('import-sidgad-dump', () => {
  it('jugadores: rellena solo huecos y respeta el apellido', async () => {
    const a = await jugador('fep_player_10', 'AZPILICUETA', { nationality: 'Italiana' });
    const b = await jugador('fep_player_11', 'GARCIA');
    await jugador('otra_fuente_12', 'LOPEZ');
    const st = await importPlayers([
      { id: '10', firstName: 'ARITZ', lastName: 'AZPILICUETA VERGARA', birthDate: '1995-03-16', nationality: 'ESPAÑOLA', photoUrl: 'https://x/10.jpg' },
      { id: '11', firstName: 'PEPE', lastName: 'MARTINEZ', birthDate: '2000-01-01', nationality: 'ESPAÑOLA', photoUrl: null },
      { id: '12', firstName: 'X', lastName: 'LOPEZ', birthDate: '2000-01-01', nationality: null, photoUrl: null },
    ], false);
    expect(st).toMatchObject({ inDump: 3, matched: 2, updated: 1, surnameMismatch: 1 });
    const ra = (await db.query(`SELECT birth_date::text AS b, nationality, photo_url FROM players WHERE id = $1`, [a])).rows[0];
    expect(ra).toEqual({ b: '1995-03-16', nationality: 'Italiana', photo_url: 'https://x/10.jpg' });
    const rb = (await db.query(`SELECT birth_date FROM players WHERE id = $1`, [b])).rows[0];
    expect(rb.birth_date).toBeNull();
  });

  it('simulación no escribe', async () => {
    const a = await jugador('fep_player_10', 'AZPILICUETA');
    const st = await importPlayers([{ id: '10', firstName: 'A', lastName: 'AZPILICUETA', birthDate: '1995-03-16', nationality: null, photoUrl: null }], true);
    expect(st.updated).toBe(1);
    expect((await db.query(`SELECT birth_date FROM players WHERE id = $1`, [a])).rows[0].birth_date).toBeNull();
  });

  it('partidos: sin coincidencias en BD cuenta lo que falta', async () => {
    const st = await importMatches([
      { idp: '1', idc: '3568', date: '2026-10-31', home: 'A', away: 'B', result: '2:2', venue: 'PALAU', acta: true, completed: true, homeScore: '2', awayScore: '2', referees: ['X'], goalEvents: 4 },
      { idp: '2', idc: '3568', date: '2026-12-31', home: 'A', away: 'C', result: null, venue: null },
    ], false);
    expect(st.inDump).toBe(2);
    expect(st.notInDb.get('3568')).toBe(1);
    expect(renderReport(null, st, false)).toContain('idc 3568: 1');
  });

  it('nacionalidad legible', () => {
    expect(niceNationality('ESPAÑOLA')).toBe('Española');
    expect(niceNationality(null)).toBeNull();
  });
});
