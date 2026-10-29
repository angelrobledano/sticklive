/** 099 — deshace la resolución de «CP VILANOVA LA DAURADA» contra el CP Vilanova. */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { db, closeDb, enqueueResolution, resolveQueueItem, findTeamByNormalizedAlias } from '@sports/db';
import { limpiar } from './support/db.js';
import { crearEquipo, crearFuente } from './support/factorias.js';

const SQL = readFileSync(fileURLToPath(new URL('../../packages/db/migrations/099_cp_vilanova_la_daurada.sql', import.meta.url)), 'utf8');
beforeEach(limpiar);
afterAll(closeDb);

describe('099 — CP Vilanova la Daurada', () => {
  it('crea el club, le cuelga sus equipos y devuelve el nombre a la cola', async () => {
    const sportId = (await db.query<{ id: string }>(
      `INSERT INTO sports (name, slug) VALUES ('Hockey', 'hockey-patines') ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`)).rows[0]!.id;
    const sourceId = await crearFuente('fep_hockey');
    const garraf = (await db.query<{ id: string }>(
      `INSERT INTO clubs (sport_id, canonical_name, slug) VALUES ($1, 'CP VILANOVA', 'cp-vilanova') RETURNING id`, [sportId])).rows[0]!.id;
    const vilanova = await crearEquipo(sportId, 'CP VILANOVA');
    const daurada = await crearEquipo(sportId, 'CP VILANOVA LA DAURADA');
    await db.query(`UPDATE teams SET club_id = $1 WHERE id IN ($2, $3)`, [garraf, vilanova, daurada]);
    await enqueueResolution({ rawText: 'CP VILANOVA LA DAURADA', normalized: 'cp vilanova la daurada', sourceId, sourceRef: 'fep_team_9', candidates: [] });
    const id = (await db.query<{ id: string }>(`SELECT id FROM resolution_queue`)).rows[0]!.id;
    await resolveQueueItem(id, vilanova, 'human:test');

    await db.query(SQL);
    await db.query(SQL);

    const club = (await db.query<{ id: string }>(`SELECT id FROM clubs WHERE slug = 'cp-vilanova-la-daurada'`)).rows[0]!.id;
    const clubDe = async (t: string) => (await db.query<{ club_id: string }>(`SELECT club_id FROM teams WHERE id = $1`, [t])).rows[0]!.club_id;
    expect(await clubDe(daurada)).toBe(club);
    expect(await clubDe(vilanova)).toBe(garraf);
    expect(await findTeamByNormalizedAlias('cp vilanova la daurada', sourceId)).toBeNull();
    const q = (await db.query<{ status: string }>(`SELECT status FROM resolution_queue WHERE id = $1`, [id])).rows[0]!;
    expect(q.status).toBe('pending');
    const map = await db.query(`SELECT 1 FROM source_entity_map WHERE source_ref = 'fep_team_9'`);
    expect(map.rowCount).toBe(0);
  });
});
