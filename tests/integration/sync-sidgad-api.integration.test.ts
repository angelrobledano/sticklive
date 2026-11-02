/**
 * Pabellones y fichas de jugador desde la API de sidgad (2/11/2026).
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { db, closeDb, venueKey } from '@sports/db';
import { limpiar } from './support/db.js';
import { crearDeporte } from './support/factorias.js';
import { syncVenues, syncPlayers } from '../../apps/etl/src/sync-sidgad-api.js';
import { SidgadApi } from '../../apps/scraper/src/sidgad-api/client.js';

beforeEach(async () => { await limpiar(); await db.query('TRUNCATE venues'); });
afterAll(async () => { await closeDb(); });

function fakeApi(responses: Record<string, unknown>): SidgadApi {
  const fetcher = (async (url: string) => {
    const u = new URL(url);
    const recurso = u.pathname.split('/').filter(Boolean).pop()!;
    const k = `${recurso}:${u.searchParams.get('id') ?? ''}:${u.searchParams.get('s') ?? ''}`;
    const body = responses[k] ?? responses[recurso] ?? { status: 'NO FILE' };
    return new Response(JSON.stringify(body), { status: 200 });
  }) as never;
  return new SidgadApi({ token: 't', client: 'rfep', base: 'https://api.example', gapMs: 0 }, fetcher);
}

async function jugador(ref: string, last: string): Promise<string> {
  const sportId = (await db.query<{ id: string }>(`SELECT id FROM sports LIMIT 1`)).rows[0]?.id ?? await crearDeporte();
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO players (sport_id, first_name, last_name, slug, source_ref)
     VALUES ($1, 'Nombre', $2, $3, $4) RETURNING id`,
    [sportId, last, `p-${ref}`, ref],
  );
  return rows[0]!.id;
}

describe('sync-sidgad-api', () => {
  it('pabellones con dirección y clave de cruce', async () => {
    const n = await syncVenues(fakeApi({ pistas: { pistas: [
      { id_pista: '57', denominacion: "PALAU D'ESPORTS DE REUS", direccion_pista: 'C/ Escornalbou,19', codigo_postal: '43203', aforo: '1500' },
    ] } }), false);
    expect(n).toBe(1);
    const v = (await db.query(`SELECT name_key, street, postal_code FROM venues`)).rows[0];
    expect(v).toEqual({ name_key: venueKey("PALAU D'ESPORTS DE REUS"), street: 'C/ Escornalbou,19', postal_code: '43203' });
  });

  it('ficha de jugador: foto, nacionalidad y nacimiento; temporada anterior si no está en la actual', async () => {
    const id = await jugador('fep_player_4095', 'Serra Molist');
    const r = await syncPlayers(fakeApi({
      'profile:4095:39': { player: { name: 'MARTÍ', surname: 'SERRA MOLIST', date_born: '05/11/1996', image: 'https://sidgad.cloud/rfep/images/fichas/4095_2.jpg', nationality: 'ESPAÑOLA' } },
    }), 10, false);
    expect(r).toEqual({ checked: 1, updated: 1, skipped: 0 });
    const p = (await db.query(`SELECT nationality, birth_date::text AS b, photo_url, profile_checked_at IS NOT NULL AS ok FROM players WHERE id = $1`, [id])).rows[0];
    expect(p).toEqual({ nationality: 'ESPAÑOLA', b: '1996-11-05', photo_url: 'https://sidgad.cloud/rfep/images/fichas/4095_2.jpg', ok: true });
  });

  it('apellido distinto: no escribe nada (id cruzado), solo marca como consultado', async () => {
    const id = await jugador('fep_player_7', 'García');
    const r = await syncPlayers(fakeApi({ 'profile:7:41': { player: { surname: 'SERRA MOLIST', date_born: '05/11/1996' } } }), 10, false);
    expect(r.skipped).toBe(1);
    const p = (await db.query(`SELECT birth_date, profile_checked_at IS NOT NULL AS ok FROM players WHERE id = $1`, [id])).rows[0];
    expect(p).toEqual({ birth_date: null, ok: true });
  });

  it('solo jugadores RFEP (fep_player_<id>)', async () => {
    await jugador('fecapa_player_9', 'X');
    const r = await syncPlayers(fakeApi({}), 10, false);
    expect(r.checked).toBe(0);
  });
});
