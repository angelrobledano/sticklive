/**
 * Plan B1 — fusión de clubes duplicados: helper de BD, endpoint de admin y
 * script de plan CSV (apply-club-plan). Postgres real.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { db, closeDb, mergeClubs, MergeClubsError } from '@sports/db';
import { limpiar } from './support/db.js';
import { crearDeporte, crearEquipo } from './support/factorias.js';
import { clubDetailRouter } from '../../apps/api/src/routes/club-detail.js';
import { parsePlan, applyClubPlan } from '../../apps/etl/src/apply-club-plan.js';

process.env['ADMIN_TOKEN'] ??= 'test-token';
const { adminRouter } = await import('../../apps/api/src/routes/admin.js');
const ADMIN = { 'x-admin-token': process.env['ADMIN_TOKEN']!, 'content-type': 'application/json' };

let sportId: string;

async function club(slug: string, name: string, city: string | null = null): Promise<string> {
  return (await db.query<{ id: string }>(
    `INSERT INTO clubs (sport_id, canonical_name, slug, city) VALUES ($1, $2, $3, $4) RETURNING id`,
    [sportId, name, slug, city],
  )).rows[0]!.id;
}

async function equipoDe(clubId: string, nombre: string): Promise<string> {
  const id = await crearEquipo(sportId, nombre);
  await db.query('UPDATE teams SET club_id = $1 WHERE id = $2', [clubId, id]);
  return id;
}

beforeEach(async () => {
  await limpiar();
  sportId = await crearDeporte();
});

afterAll(async () => {
  await closeDb();
});

describe('mergeClubs', () => {
  it('mueve equipos, hereda ciudad y deja el slug viejo redirigiendo', async () => {
    const buena = await club('generali-hc-palau', 'Generali HC Palau');
    const sobrante = await club('generali-hc-palau-fecapa-club-271', 'Generali HC Palau', 'Palau-solità');
    await db.query(`INSERT INTO club_slug_redirects (old_slug, club_id) VALUES ('palau-viejo', $1)`, [sobrante]);
    const t1 = await equipoDe(buena, 'GENERALI HC PALAU');
    const t2 = await equipoDe(sobrante, 'GENERALI HC PALAU A');

    const r = await mergeClubs(sobrante, buena);
    expect(r.teamsMoved).toBe(1);

    const { rows: teams } = await db.query('SELECT id FROM teams WHERE club_id = $1 ORDER BY id', [buena]);
    expect(teams.map((t: any) => t.id).sort()).toEqual([t1, t2].sort());
    expect((await db.query('SELECT 1 FROM clubs WHERE id = $1', [sobrante])).rowCount).toBe(0);
    expect((await db.query('SELECT city FROM clubs WHERE id = $1', [buena])).rows[0].city).toBe('Palau-solità');

    for (const slug of ['generali-hc-palau-fecapa-club-271', 'palau-viejo']) {
      const res = await clubDetailRouter.request(`/${slug}`);
      expect(res.status).toBe(200);
      expect((await res.json()).club.slug).toBe('generali-hc-palau');
    }
  });

  it('rechaza fusionar un club consigo mismo', async () => {
    const a = await club('a', 'A');
    await expect(mergeClubs(a, a)).rejects.toBeInstanceOf(MergeClubsError);
  });
});

describe('POST /admin/clubs/:id/merge', () => {
  it('fusiona por slug del destino', async () => {
    const buena = await club('igualada-hc', 'Igualada HC');
    const sobrante = await club('igualada-rigat-hc', 'Igualada Rigat HC');
    await equipoDe(sobrante, 'IGUALADA RIGAT HC');
    const res = await adminRouter.request(`/clubs/${sobrante}/merge`, {
      method: 'POST', headers: ADMIN, body: JSON.stringify({ into: 'igualada-hc' }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).teamsMoved).toBe(1);
    expect((await db.query('SELECT count(*)::int AS n FROM teams WHERE club_id = $1', [buena])).rows[0].n).toBe(1);
  });

  it('destino inexistente → 404', async () => {
    const a = await club('a', 'A');
    const res = await adminRouter.request(`/clubs/${a}/merge`, {
      method: 'POST', headers: ADMIN, body: JSON.stringify({ into: 'no-existe' }),
    });
    expect(res.status).toBe(404);
  });
});

describe('apply-club-plan', () => {
  const PLAN = [
    'accion;slug;destino;nombre;nuevo_slug',
    'renombrar;hc-palau-2;;HC Palau;hc-palau',
    'fusionar;generali-hc-palau-fecapa-club-271;hc-palau-2;;',
    'seleccion;catalunya;;;',
    ';ignorada;;;',
  ].join('\n');

  it('parsea y ordena: fusiones, renombrados, selecciones', () => {
    expect(parsePlan(PLAN).map((r) => r.accion)).toEqual(['fusionar', 'renombrar', 'seleccion']);
    expect(() => parsePlan('accion;slug\nborrar;x')).toThrow(/acción desconocida/);
  });

  it('dry-run no escribe y --write aplica todo', async () => {
    const buena = await club('hc-palau-2', 'Generali HC Palau');
    const sobrante = await club('generali-hc-palau-fecapa-club-271', 'Generali HC Palau');
    const cat = await club('catalunya', 'Catalunya');
    await equipoDe(sobrante, 'GENERALI HC PALAU');
    const sel = await equipoDe(cat, 'CATALUNYA');

    const dry = await applyClubPlan(parsePlan(PLAN), false);
    expect(dry.errors).toEqual([]);
    expect((await db.query('SELECT count(*)::int AS n FROM clubs')).rows[0].n).toBe(3);

    const real = await applyClubPlan(parsePlan(PLAN), true);
    expect(real.errors).toEqual([]);
    const palau = (await db.query('SELECT slug, canonical_name FROM clubs WHERE id = $1', [buena])).rows[0];
    expect(palau).toEqual({ slug: 'hc-palau', canonical_name: 'HC Palau' });
    expect((await db.query('SELECT 1 FROM clubs WHERE id = $1', [sobrante])).rowCount).toBe(0);
    expect((await db.query('SELECT team_type, club_id FROM teams WHERE id = $1', [sel])).rows[0])
      .toEqual({ team_type: 'national', club_id: null });
    const { rows } = await db.query('SELECT old_slug FROM club_slug_redirects WHERE club_id = $1 ORDER BY old_slug', [buena]);
    expect(rows.map((r: any) => r.old_slug)).toEqual(['generali-hc-palau-fecapa-club-271', 'hc-palau-2']);
  });
});
