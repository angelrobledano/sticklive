/**
 * Plan B1 — ficha de club: GET /clubs/:key, renombrado de slug desde /admin con
 * redirección del slug antiguo (migración 091) y exclusión de selecciones.
 * Postgres real; se golpean los routers de Hono con `.request()`.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { db, closeDb } from '@sports/db';
import { limpiar } from './support/db.js';
import { crearDeporte, crearEquipo, crearCompeticion, crearTemporada } from './support/factorias.js';
import { clubDetailRouter } from '../../apps/api/src/routes/club-detail.js';

process.env['ADMIN_TOKEN'] ??= 'test-token';
const { adminRouter } = await import('../../apps/api/src/routes/admin.js');
const ADMIN = { 'x-admin-token': process.env['ADMIN_TOKEN']!, 'content-type': 'application/json' };

let sportId: string;
let clubId: string;
let seasonId: string;
let first: string;
let fem: string;

async function getClub(key: string): Promise<{ status: number; body: any }> {
  const res = await clubDetailRouter.request(`/${key}`);
  return { status: res.status, body: await res.json() };
}

async function partido(home: string, away: string, status: string, horas: number): Promise<void> {
  await db.query(
    `INSERT INTO matches (season_id, home_team_id, away_team_id, status, scheduled_at, source_ref, home_score, away_score)
     VALUES ($1, $2, $3, $4, NOW() + make_interval(hours => $5::int), $6, $7, $8)`,
    [seasonId, home, away, status, horas, `m_${Math.random()}`, status === 'finished' ? 3 : null, status === 'finished' ? 1 : null],
  );
}

beforeEach(async () => {
  await limpiar();
  sportId = await crearDeporte();
  const comp = await crearCompeticion(sportId);
  seasonId = await crearTemporada(comp, { esActual: true });
  clubId = (await db.query<{ id: string }>(
    `INSERT INTO clubs (sport_id, canonical_name, slug, city) VALUES ($1, 'Generali HC Palau', 'generali-hc-palau', 'Palau') RETURNING id`,
    [sportId],
  )).rows[0]!.id;
  first = await crearEquipo(sportId, 'GENERALI HC PALAU');
  fem = await crearEquipo(sportId, 'GENERALI HC PALAU');
  const sinPartidos = await crearEquipo(sportId, 'GENERALI HC PALAU C');
  const seleccion = await crearEquipo(sportId, 'CATALUNYA');
  const rival = await crearEquipo(sportId, 'RIVAL');
  await db.query(`UPDATE teams SET club_id = $1, gender = 'male' WHERE id IN ($2, $3)`, [clubId, first, sinPartidos]);
  await db.query(`UPDATE teams SET club_id = $1, gender = 'female' WHERE id = $2`, [clubId, fem]);
  await db.query(`UPDATE teams SET club_id = $1, team_type = 'national' WHERE id = $2`, [clubId, seleccion]);
  await partido(first, rival, 'finished', -48);
  await partido(rival, fem, 'scheduled', 72);
  await partido(seleccion, rival, 'finished', -24);
});

afterAll(async () => {
  await closeDb();
});

describe('GET /clubs/:key', () => {
  it('por slug: secciones con partidos (sin selecciones ni fichas vacías) y partidos', async () => {
    const { status, body } = await getClub('generali-hc-palau');
    expect(status).toBe(200);
    expect(body.club).toMatchObject({ id: clubId, slug: 'generali-hc-palau', name: 'Generali HC Palau' });
    expect(body.teams.map((t: any) => t.id)).toEqual([first, fem]);
    expect(body.teams[1].sectionSuffix).toBe('F');
    expect(body.recent).toHaveLength(1);
    expect(body.upcoming).toHaveLength(1);
    expect(body.indexable).toBe(true);
  });

  it('por UUID devuelve el mismo club (la web redirige al slug)', async () => {
    const { status, body } = await getClub(clubId);
    expect(status).toBe(200);
    expect(body.club.slug).toBe('generali-hc-palau');
  });

  it('slug inexistente o mal formado → 404', async () => {
    expect((await getClub('no-existe')).status).toBe(404);
    expect((await getClub('No Existe')).status).toBe(404);
  });
});

describe('PATCH /admin/clubs/:id', () => {
  it('renombra y el slug antiguo sigue resolviendo al club', async () => {
    const res = await adminRouter.request(`/clubs/${clubId}`, {
      method: 'PATCH', headers: ADMIN, body: JSON.stringify({ canonicalName: 'HC Palau', slug: 'hc-palau' }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).club).toMatchObject({ slug: 'hc-palau', canonicalName: 'HC Palau' });

    const viejo = await getClub('generali-hc-palau');
    expect(viejo.status).toBe(200);
    expect(viejo.body.club.slug).toBe('hc-palau');
    expect((await getClub('hc-palau')).body.club.name).toBe('HC Palau');
  });

  it('volver al slug antiguo lo saca de las redirecciones', async () => {
    for (const slug of ['hc-palau', 'generali-hc-palau']) {
      const res = await adminRouter.request(`/clubs/${clubId}`, { method: 'PATCH', headers: ADMIN, body: JSON.stringify({ slug }) });
      expect(res.status).toBe(200);
    }
    const { rows } = await db.query('SELECT old_slug FROM club_slug_redirects ORDER BY old_slug');
    expect(rows.map((r: any) => r.old_slug)).toEqual(['hc-palau']);
  });

  it('slug ocupado por otro club → 409', async () => {
    await db.query(`INSERT INTO clubs (sport_id, canonical_name, slug) VALUES ($1, 'Otro', 'otro-club')`, [sportId]);
    const res = await adminRouter.request(`/clubs/${clubId}`, { method: 'PATCH', headers: ADMIN, body: JSON.stringify({ slug: 'otro-club' }) });
    expect(res.status).toBe(409);
  });
});
