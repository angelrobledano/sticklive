/**
 * A4 — backfill de clubes por escudo (clave de club sidgad).
 *
 * Reproduce el caso Calafell: un equipo actual con su club 1:1 del backfill
 * de agosto y tres equipos históricos sin club, todos con el escudo
 * `rfep/images/logos_clubes/calafell.png`.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { db, closeDb } from '@sports/db';
import { limpiar } from './support/db.js';
import { crearDeporte, crearEquipo, crearFuente } from './support/factorias.js';
import { backfillClubsByCrest, fillSectionFromCompetitions } from '../../apps/etl/src/backfill-clubs-by-crest.js';

beforeEach(limpiar);
afterAll(closeDb);

const CREST = 'https://sidgad.cloud/rfep/images/logos_clubes/calafell.png';

async function equipoConEscudo(sportId: string, nombre: string, logo: string | null) {
  const id = await crearEquipo(sportId, nombre);
  await db.query(`UPDATE teams SET logo_url = $2 WHERE id = $1`, [id, logo]);
  return id;
}

async function escenario() {
  const sportId = await crearDeporte();
  await crearFuente('fep_hockey');
  const actual = await equipoConEscudo(sportId, 'CALAFELL LA MENORQUINA', CREST);
  const club = (await db.query<{ id: string }>(
    `INSERT INTO clubs (sport_id, canonical_name, slug) VALUES ($1,'CALAFELL LA MENORQUINA','calafell-la-menorquina') RETURNING id`,
    [sportId])).rows[0]!.id;
  await db.query(`UPDATE teams SET club_id = $1 WHERE id = $2`, [club, actual]);
  const historicos = [
    await equipoConEscudo(sportId, 'PARLEM CALAFELL', CREST),
    await equipoConEscudo(sportId, "CP CALAFELL TOT L'ANY", CREST),
    await equipoConEscudo(sportId, "CLUB PATI CALAFELL TOT L'ANY", CREST),
  ];
  const sinEscudo = await equipoConEscudo(sportId, "CALAFELL TOT L'ANY", null);
  return { club, actual, historicos, sinEscudo };
}

describe('A4 — backfillClubsByCrest', () => {
  it('en dry-run agrupa y no escribe', async () => {
    const e = await escenario();
    const r = await backfillClubsByCrest({ write: false });
    const g = r.groups.find((x) => x.clubRef === 'fep_club_calafell')!;
    expect(g.teamIds.sort()).toEqual([e.actual, ...e.historicos].sort());
    const sinClub = await db.query(`SELECT count(*)::int AS n FROM teams WHERE club_id IS NULL`);
    expect(sinClub.rows[0]!.n).toBe(4);
  });

  it('con write cuelga los históricos del club existente y deja intacto el que no tiene escudo', async () => {
    const e = await escenario();
    await backfillClubsByCrest({ write: true });
    const clubs = await db.query<{ club_id: string }>(
      `SELECT club_id FROM teams WHERE id = ANY($1)`, [[e.actual, ...e.historicos]]);
    expect(new Set(clubs.rows.map((r) => r.club_id))).toEqual(new Set([e.club]));
    const sin = await db.query(`SELECT club_id FROM teams WHERE id = $1`, [e.sinEscudo]);
    expect(sin.rows[0]).toEqual({ club_id: null });
  });

  it('dos clubes 1:1 con el mismo escudo se informan como fusión, no se fusionan sin --merge-clubs', async () => {
    const e = await escenario();
    const otro = (await db.query<{ id: string }>(
      `INSERT INTO clubs (sport_id, canonical_name, slug) SELECT sport_id, 'PARLEM CALAFELL', 'parlem-calafell' FROM teams WHERE id = $1 RETURNING id`,
      [e.historicos[0]])).rows[0]!.id;
    await db.query(`UPDATE teams SET club_id = $1 WHERE id = $2`, [otro, e.historicos[0]]);

    const r = await backfillClubsByCrest({ write: true });
    expect(r.mergeCandidates).toEqual([{ clubRef: 'fep_club_calafell', clubIds: expect.arrayContaining([e.club, otro]) }]);
    const sigue = await db.query(`SELECT club_id FROM teams WHERE id = $1`, [e.historicos[0]]);
    expect(sigue.rows[0]).toEqual({ club_id: otro });

    await backfillClubsByCrest({ write: true, mergeClubs: true });
    const fusion = await db.query(`SELECT club_id FROM teams WHERE id = $1`, [e.historicos[0]]);
    expect(fusion.rows[0]).toEqual({ club_id: e.club });
    const queda = await db.query(`SELECT count(*)::int AS n FROM clubs WHERE id = $1`, [otro]);
    expect(queda.rows[0]!.n).toBe(0);
  });
});

describe('A4 — género y categoría desde las competiciones', () => {
  it('rellena solo cuando todas las competiciones del equipo coinciden', async () => {
    const sportId = await crearDeporte();
    const comp = async (slug: string, gender: string) => (await db.query<{ id: string }>(
      `INSERT INTO competitions (sport_id, name, slug, gender, age_category) VALUES ($1,$2,$2,$3,'senior') RETURNING id`,
      [sportId, slug, gender])).rows[0]!.id;
    const temp = async (c: string) => (await db.query<{ id: string }>(
      `INSERT INTO seasons (competition_id, name, slug) VALUES ($1,'t','t') RETURNING id`, [c])).rows[0]!.id;
    const masc = await temp(await comp('okm', 'male'));
    const fem = await temp(await comp('okf', 'female'));
    const claro = await crearEquipo(sportId, 'CLARO');
    const mixto = await crearEquipo(sportId, 'MIXTO');
    await db.query(`INSERT INTO season_teams (season_id, team_id) VALUES ($1,$2),($1,$3),($4,$3)`, [masc, claro, mixto, fem]);

    const n = await fillSectionFromCompetitions({ write: true });
    expect(n).toBe(1);
    const rows = await db.query(`SELECT name, gender, age_category FROM teams ORDER BY name`);
    expect(rows.rows).toEqual([
      { name: 'CLARO', gender: 'male', age_category: 'senior' },
      { name: 'MIXTO', gender: null, age_category: null },
    ]);
  });
});
