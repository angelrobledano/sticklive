/**
 * Memoria de bajas y fusiones (F1-7, DQ-02 de docs/AUDITORIA_SEO_2026-10-16.md).
 *
 * Cuando una ficha desaparece (un placeholder sintético que cede ante el partido
 * real, dos competiciones que se fusionan, un borrado manual), su URL dejaba de
 * existir sin rastro: 404 sin destino. Search Console lo confirmó: la segunda
 * página con más clics del sitio era un partido borrado.
 *
 * `entity_redirects` guarda el id que desaparece y, si lo hay, el que lo
 * sustituye. Un trigger registra TODO borrado (aunque el código que borra no lo
 * sepa) y las rutas que conocen el sustituto lo rellenan.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { db, closeDb, reconcileSyntheticMatches, mergeCompetitions } from '@sports/db';
import { redirectsRouter } from '../../apps/api/src/routes/redirects.js';
import { limpiar } from './support/db.js';
import { crearDeporte, crearCompeticion, crearTemporada, crearPartido } from './support/factorias.js';

async function redirectDe(type: string, id: string) {
  const { rows } = await db.query<{ new_id: string | null; reason: string }>(
    `SELECT new_id, reason FROM entity_redirects WHERE entity_type = $1 AND old_id = $2`,
    [type, id]
  );
  return rows[0] ?? null;
}

async function get(path: string) {
  const res = await redirectsRouter.request(path);
  return { status: res.status, body: (await res.json().catch(() => null)) as Record<string, unknown> | null };
}

beforeEach(limpiar);
afterAll(closeDb);

describe('entity_redirects: el trigger recuerda todo borrado', () => {
  it('borrar un partido deja su id registrado sin sustituto', async () => {
    const { matchId } = await crearPartido();
    await db.query(`DELETE FROM matches WHERE id = $1`, [matchId]);
    expect(await redirectDe('match', matchId)).toEqual({ new_id: null, reason: 'deleted' });
  });

  it('también equipos, jugadores y competiciones', async () => {
    const sportId = await crearDeporte();
    const competitionId = await crearCompeticion(sportId);
    await db.query(`DELETE FROM competitions WHERE id = $1`, [competitionId]);
    expect((await redirectDe('competition', competitionId))?.new_id).toBeNull();
  });
});

describe('entity_redirects: las fusiones apuntan al superviviente', () => {
  it('un sintético que cede ante el partido real redirige al real', async () => {
    const { seasonId, homeTeamId, awayTeamId, matchId: realId } = await crearPartido({ sourceRef: 'fep_match_1' });
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO matches (season_id, home_team_id, away_team_id, status, scheduled_at, source_ref)
       SELECT season_id, home_team_id, away_team_id, 'scheduled', scheduled_at, 'synthetic:x'
         FROM matches WHERE id = $1 RETURNING id`,
      [realId]
    );
    const syntheticId = rows[0]!.id;
    expect(homeTeamId && awayTeamId).toBeTruthy();

    const removed = await reconcileSyntheticMatches(seasonId);
    expect(removed).toBe(1);
    expect(await redirectDe('match', syntheticId)).toEqual({ new_id: realId, reason: 'synthetic-adopted' });
  });

  it('fusionar competiciones redirige la absorbida a la canónica', async () => {
    const sportId = await crearDeporte();
    const keepId = await crearCompeticion(sportId);
    const mergeId = await crearCompeticion(sportId);
    await crearTemporada(mergeId);

    await mergeCompetitions(keepId, mergeId);
    expect(await redirectDe('competition', mergeId)).toEqual({ new_id: keepId, reason: 'merged' });
  });
});

describe('GET /redirects/:type/:id', () => {
  it('sigue la cadena hasta el superviviente actual', async () => {
    const a = (await crearPartido()).matchId;
    const b = (await crearPartido()).matchId;
    const c = (await crearPartido()).matchId;
    await db.query(
      `INSERT INTO entity_redirects (entity_type, old_id, new_id, reason) VALUES
         ('match', $1, $2, 'merged'), ('match', $2, $3, 'merged')`,
      [a, b, c]
    );
    // a y b ya no existen en la realidad; aquí basta con que c exista.
    const res = await get(`/match/${a}`);
    expect(res).toEqual({ status: 200, body: { status: 'moved', newId: c } });
  });

  it('borrado sin sustituto: gone', async () => {
    const { matchId } = await crearPartido();
    await db.query(`DELETE FROM matches WHERE id = $1`, [matchId]);
    expect(await get(`/match/${matchId}`)).toEqual({ status: 200, body: { status: 'gone' } });
  });

  it('si el sustituto también desapareció sin destino: gone', async () => {
    const x = (await crearPartido()).matchId;
    const y = (await crearPartido()).matchId;
    await db.query(`INSERT INTO entity_redirects (entity_type, old_id, new_id, reason) VALUES ('match', $1, $2, 'merged')`, [x, y]);
    await db.query(`DELETE FROM matches WHERE id = $1`, [y]);
    expect((await get(`/match/${x}`)).body).toEqual({ status: 'gone' });
  });

  it('id desconocido: 404', async () => {
    expect((await get('/team/00000000-0000-0000-0000-000000000000')).status).toBe(404);
  });

  it('tipo o id inválidos: 400', async () => {
    expect((await get('/foo/00000000-0000-0000-0000-000000000000')).status).toBe(400);
    expect((await get('/team/zzz')).status).toBe(400);
  });
});
