/** 101 — las competiciones de la FVP sin logo llevan el escudo de la federación. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { db, closeDb } from '@sports/db';
import { limpiar } from './support/db.js';
import { crearDeporte, crearCompeticion } from './support/factorias.js';

const SQL = readFileSync(fileURLToPath(new URL('../../packages/db/migrations/101_fvp_competition_logos.sql', import.meta.url)), 'utf8');
beforeEach(limpiar);
afterAll(closeDb);

describe('101 — logos FVP', () => {
  it('rellena las vascas sin logo; no toca un logo puesto ni otras federaciones', async () => {
    const sportId = await crearDeporte();
    const [sin, con, otra] = [await crearCompeticion(sportId), await crearCompeticion(sportId), await crearCompeticion(sportId)];
    await db.query(`UPDATE competitions SET organizer = 'FVP', logo_url = NULL WHERE id = $1`, [sin]);
    await db.query(`UPDATE competitions SET organizer = 'FVP', logo_url = 'https://x/propio.png' WHERE id = $1`, [con]);
    await db.query(`UPDATE competitions SET organizer = 'FAP', logo_url = NULL WHERE id = $1`, [otra]);
    await db.query(SQL);
    const logo = async (id: string) => (await db.query<{ logo_url: string | null }>(`SELECT logo_url FROM competitions WHERE id = $1`, [id])).rows[0]!.logo_url;
    expect(await logo(sin)).toBe('https://sticklive.eu/federaciones/fvp.png');
    expect(await logo(con)).toBe('https://x/propio.png');
    expect(await logo(otra)).toBeNull();
  });
});
