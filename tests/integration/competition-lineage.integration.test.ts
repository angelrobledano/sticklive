/**
 * B4 — linaje de competición: un idc que la fuente publica aparte y que en
 * realidad es una FASE (play-off) o un GRUPO (Norte/Sur) de otra competición.
 *
 * Caso real: "OK LIGA PLATA MASCULINA ELIMINATORIA" está en producción como
 * competición independiente de "OK LIGA PLATA", mientras que el play-off de
 * OK Liga se fusionó a mano (migraciones 014 y 026). `attachCompetitionAsPhase`
 * hace esa fusión de forma genérica y deja declarado el idc en
 * competition_sources para que el pipeline lo cargue ya dentro de la madre.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { db, closeDb, attachCompetitionAsPhase, resolveEntityRedirect } from '@sports/db';
import { limpiar } from './support/db.js';
import { crearDeporte, crearEquipo, crearFuente } from './support/factorias.js';

beforeEach(limpiar);
afterAll(closeDb);

async function competicion(sportId: string, sourceId: string, name: string, idc: string) {
  const comp = (await db.query<{ id: string }>(
    `INSERT INTO competitions (sport_id, name, slug, source_ref) VALUES ($1,$2,$2,$3) RETURNING id`,
    [sportId, name, idc])).rows[0]!.id;
  const season = (await db.query<{ id: string }>(
    `INSERT INTO seasons (competition_id, name, slug, is_current) VALUES ($1,'2025/26','2025-26',TRUE) RETURNING id`,
    [comp])).rows[0]!.id;
  await db.query(`INSERT INTO competition_sources (competition_id, source_id, external_ids) VALUES ($1,$2,$3)`,
    [comp, sourceId, JSON.stringify({ idc, playoff_idcs: [], cup_idcs: [] })]);
  return { comp, season };
}

async function partido(season: string, a: string, b: string, ref: string, roundNumber: number, roundType: string) {
  const round = (await db.query<{ id: string }>(
    `INSERT INTO rounds (season_id, number, name, round_type) VALUES ($1,$2,$3,$4)
     ON CONFLICT DO NOTHING RETURNING id`, [season, roundNumber, `R${roundNumber}`, roundType])).rows[0]?.id
    ?? (await db.query<{ id: string }>(`SELECT id FROM rounds WHERE season_id=$1 AND number=$2`, [season, roundNumber])).rows[0]!.id;
  await db.query(
    `INSERT INTO matches (season_id, round_id, home_team_id, away_team_id, status, scheduled_at, source_ref)
     VALUES ($1,$2,$3,$4,'finished',NOW(),$5)`, [season, round, a, b, ref]);
}

async function escenario() {
  const sportId = await crearDeporte();
  const sourceId = await crearFuente('fep_hockey');
  const [a, b] = [await crearEquipo(sportId, 'A'), await crearEquipo(sportId, 'B')];
  const madre = await competicion(sportId, sourceId, 'OK LIGA PLATA', '3500');
  const hija = await competicion(sportId, sourceId, 'OK LIGA PLATA MASCULINA ELIMINATORIA', '3600');
  await partido(madre.season, a, b, 'fep_match_1', 1, 'regular');
  await partido(hija.season, a, b, 'fep_match_2', 1, 'playoff');
  await db.query(`INSERT INTO season_teams (season_id, team_id) VALUES ($1,$2),($1,$3)`, [hija.season, a, b]);
  return { madre, hija };
}

describe('B4 — attachCompetitionAsPhase', () => {
  it('en dry-run describe el plan y no toca nada', async () => {
    const e = await escenario();
    const plan = await attachCompetitionAsPhase({ childId: e.hija.comp, parentId: e.madre.comp, kind: 'knockout', write: false });
    expect(plan.seasons).toEqual([{ childSeasonId: e.hija.season, parentSeasonId: e.madre.season, name: '2025/26', matches: 1 }]);
    const n = await db.query(`SELECT count(*)::int AS n FROM competitions`);
    expect(n.rows[0]!.n).toBe(2);
  });

  it('mueve partidos y rondas a una fase nueva de la temporada madre y declara el idc', async () => {
    const e = await escenario();
    await attachCompetitionAsPhase({ childId: e.hija.comp, parentId: e.madre.comp, kind: 'knockout', write: true });

    const m = await db.query<{ season_id: string; kind: string; name: string }>(
      `SELECT m.season_id, p.kind, p.name FROM matches m JOIN phases p ON p.id = m.phase_id WHERE m.source_ref = 'fep_match_2'`);
    expect(m.rows[0]).toEqual({ season_id: e.madre.season, kind: 'knockout', name: 'OK LIGA PLATA MASCULINA ELIMINATORIA' });
    const r = await db.query(`SELECT count(*)::int AS n FROM rounds WHERE season_id = $1`, [e.madre.season]);
    expect(r.rows[0]!.n).toBe(2);

    const cs = await db.query<{ external_ids: { playoff_idcs: string[] } }>(
      `SELECT external_ids FROM competition_sources WHERE competition_id = $1`, [e.madre.comp]);
    expect(cs.rows[0]!.external_ids.playoff_idcs).toEqual(['3600']);

    await expect(resolveEntityRedirect('competition', e.hija.comp)).resolves.toEqual({ status: 'moved', newId: e.madre.comp });
  });

  it('como grupo territorial, etiqueta partidos e inscripciones con el grupo', async () => {
    const e = await escenario();
    await attachCompetitionAsPhase({ childId: e.hija.comp, parentId: e.madre.comp, kind: 'groups', groupName: 'Sur', write: true });
    const m = await db.query(`SELECT group_name FROM matches WHERE source_ref = 'fep_match_2'`);
    expect(m.rows[0]).toEqual({ group_name: 'Sur' });
    const st = await db.query(`SELECT DISTINCT group_name FROM season_teams WHERE season_id = $1`, [e.madre.season]);
    expect(st.rows).toEqual([{ group_name: 'Sur' }]);
  });

  it('se niega si una temporada de la hija no tiene pareja en la madre', async () => {
    const e = await escenario();
    await db.query(`INSERT INTO seasons (competition_id, name, slug, is_current) VALUES ($1,'2024/25','2024-25',FALSE)`, [e.hija.comp]);
    await expect(attachCompetitionAsPhase({ childId: e.hija.comp, parentId: e.madre.comp, kind: 'knockout', write: true }))
      .rejects.toThrow(/2024\/25/);
  });
});
