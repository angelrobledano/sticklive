/**
 * match.loader — el loader del directo, con la lógica de más riesgo de
 * duplicados/fantasmas. Corre cada ~45 s en producción. Se prueba llamando a
 * loadMatches() contra Postgres real (arnés compartido, aislamiento por
 * TRUNCATE), ejercitando:
 *   - adopción de placeholders sintéticos (sin duplicar)
 *   - adopción por COMPETICIÓN+FECHA cuando el feed de directo no resuelve equipos
 *     (refs de club `fep_club_XX`): el placeholder recibe el idp real y su marcador
 *   - guarda anti-duplicados del placeholder cuando ya existe el real
 *   - omisión del placeholder sintético con fecha pasada
 *   - fallback solo-marcador cuando el equipo no resuelve
 *
 * Cubre T-023..T-028 de docs/AUDITORIA_TESTS.md.
 */
import { describe, test, expect, beforeEach, afterAll } from 'vitest';
import { db, closeDb, learnSourceClub } from '@sports/db';
import type { ScrapedMatch, ScrapeResult } from '@sports/shared-types';
import { limpiar } from './support/db.js';
import { crearDeporte, crearCompeticion, crearTemporada } from './support/factorias.js';
import { loadMatches } from '../../apps/etl/src/loaders/match.loader.js';

let sportId: string;
let seasonId: string;
let sourceId: string;

async function crearFuenteId(): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO data_sources (name, base_url, scraper_key) VALUES ('Fuente test','https://x.invalido/f','fep_hockey')
     ON CONFLICT (scraper_key) DO UPDATE SET name = EXCLUDED.name RETURNING id`);
  return rows[0]!.id;
}

/** Equipo resoluble por el puente teams.source_ref (+ source_id). */
async function equipoConRef(ref: string, nombre: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO teams (sport_id, name, slug, source_id, source_ref)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [sportId, nombre, nombre.toLowerCase().replace(/\s+/g, '-'), sourceId, ref]);
  return rows[0]!.id;
}

function scraped(over: Partial<ScrapedMatch>): ScrapedMatch {
  return {
    seasonId,
    homeTeamRef: 'home-ref',
    awayTeamRef: 'away-ref',
    sourceId,
    scrapedAt: new Date(),
    ...over,
  } as ScrapedMatch;
}

function resultOf(items: ScrapedMatch[]): ScrapeResult<ScrapedMatch> {
  return { success: true, data: items, errors: [], durationMs: 1, scraperKey: 'fep_hockey', entityType: 'match' };
}

async function countMatches(where = '', params: unknown[] = []): Promise<number> {
  const { rows } = await db.query<{ c: string }>(`SELECT count(*)::int c FROM matches ${where}`, params);
  return Number(rows[0]!.c);
}

beforeEach(async () => {
  await limpiar();
  sportId = await crearDeporte();
  sourceId = await crearFuenteId();
  const competitionId = await crearCompeticion(sportId);
  seasonId = await crearTemporada(competitionId, { esActual: true });
});

afterAll(async () => {
  await closeDb();
});

describe('match.loader (I2)', () => {
  test('T-023 upsert normal: equipos resolubles → partido insertado', async () => {
    await equipoConRef('t-home', 'Equipo Casa');
    await equipoConRef('t-away', 'Equipo Fuera');
    const r = await loadMatches(resultOf([
      scraped({ homeTeamRef: 't-home', awayTeamRef: 't-away', sourceRef: 'm-real-1', status: 'finished', homeScore: 3, awayScore: 1, scheduledAt: new Date().toISOString() }),
    ]), sportId);
    expect(r.upserted).toBe(1);
    expect(await countMatches(`WHERE source_ref = $1`, ['m-real-1'])).toBe(1);
  });

  test('T-024 adopta el placeholder sintético cuando llega el partido real (sin duplicar)', async () => {    const home = await equipoConRef('t-home', 'Equipo Casa');
    const away = await equipoConRef('t-away', 'Equipo Fuera');
    const fecha = '2026-03-01T18:00:00.000Z';
    const synthRef = `synthetic:${seasonId}:t-home:t-away:${fecha}`;
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO matches (season_id, home_team_id, away_team_id, scheduled_at, status, source_ref)
       VALUES ($1,$2,$3,$4,'scheduled',$5) RETURNING id`,
      [seasonId, home, away, fecha, synthRef]);
    const idOriginal = rows[0]!.id;

    const r = await loadMatches(resultOf([
      scraped({ homeTeamRef: 't-home', awayTeamRef: 't-away', sourceRef: 'idp-real-1', scheduledAt: fecha, status: 'finished', homeScore: 2, awayScore: 2 }),
    ]), sportId);
    expect(r.upserted).toBe(1);
    // Un solo partido para el cruce: el sintético fue ADOPTADO, no duplicado.
    expect(await countMatches(`WHERE season_id=$1 AND home_team_id=$2 AND away_team_id=$3`, [seasonId, home, away])).toBe(1);
    const row = (await db.query<{ id: string; source_ref: string }>(`SELECT id, source_ref FROM matches WHERE season_id=$1`, [seasonId])).rows[0]!;
    expect(row.id).toBe(idOriginal);          // conserva id, historial, favoritos
    expect(row.source_ref).toBe('idp-real-1'); // ref reescrita a la real
  });

  test('T-024b adopta por COMPETICIÓN+FECHA cuando el feed trae refs de club (sin cruzar equipos)', async () => {
    const home = await equipoConRef('3685', 'CE NOIA FREIXENET B');
    const away = await equipoConRef('3727', 'AUTO VIGATANA PATI VIC');
    const fecha = '2026-09-27T16:30:00.000Z';
    await db.query(`UPDATE competitions SET name = 'OK LIGA PLATA SUR'`);
    const synthRef = `synthetic:${seasonId}:3685:3727:${fecha}`;
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO matches (season_id, home_team_id, away_team_id, scheduled_at, status, source_ref)
       VALUES ($1,$2,$3,$4,'live',$5) RETURNING id`,
      [seasonId, home, away, fecha, synthRef]);
    const idOriginal = rows[0]!.id;

    // Fila del feed de directo: equipos por ref de CLUB (no resolubles), con idp
    // real, competición y fecha. El placeholder debe ADOPTAR su ref y su marcador.
    const r = await loadMatches(resultOf([
      scraped({
        homeTeamRef: 'fep_club_71',
        awayTeamRef: 'fep_club_738',
        competitionName: 'OK LIGA PLATA SUR',
        scheduledAt: fecha,
        sourceRef: 'fep_match_35533',
        status: 'live',
        homeScore: 1,
        awayScore: 1,
      }),
    ]), sportId);

    expect(r.upserted).toBe(1);
    expect(r.skipped).toBe(0);
    const row = (await db.query<{ id: string; source_ref: string; home_score: number; away_score: number }>(
      `SELECT id, source_ref, home_score, away_score FROM matches WHERE season_id=$1`, [seasonId])).rows[0]!;
    expect(row.id).toBe(idOriginal);                 // adoptado, no duplicado
    expect(row.source_ref).toBe('fep_match_35533');  // ya tiene el idp real (el cron podrá pedir el acta)
    expect(row.home_score).toBe(1);
    expect(row.away_score).toBe(1);
  });

  test('T-025 no inserta el placeholder sintético si ya existe el partido real', async () => {
    const home = await equipoConRef('t-home', 'Equipo Casa');
    const away = await equipoConRef('t-away', 'Equipo Fuera');
    const fecha = new Date(Date.now() + 24 * 3_600_000).toISOString(); // futuro
    await db.query(
      `INSERT INTO matches (season_id, home_team_id, away_team_id, scheduled_at, status, source_ref)
       VALUES ($1,$2,$3,$4,'scheduled','idp-real-2')`,
      [seasonId, home, away, fecha]);

    const r = await loadMatches(resultOf([
      scraped({ homeTeamRef: 't-home', awayTeamRef: 't-away', scheduledAt: fecha }), // sin sourceRef → sintético
    ]), sportId);
    expect(r.skipped).toBe(1);
    expect(await countMatches(`WHERE source_ref LIKE 'synthetic:%'`)).toBe(0);
    expect(await countMatches()).toBe(1); // solo el real
  });

  test('T-026 omite el placeholder sintético con fecha pasada (no crea fantasmas)', async () => {
    await equipoConRef('t-home', 'Equipo Casa');
    await equipoConRef('t-away', 'Equipo Fuera');
    const pasado = new Date(Date.now() - 7 * 3_600_000).toISOString(); // hace 7 h
    const r = await loadMatches(resultOf([
      scraped({ homeTeamRef: 't-home', awayTeamRef: 't-away', scheduledAt: pasado }), // sin sourceRef → sintético
    ]), sportId);
    expect(r.skipped).toBe(1);
    expect(await countMatches()).toBe(0);
  });

  test('T-027 fallback solo-marcador: equipo no resoluble pero el partido existe por source_ref', async () => {
    const home = await equipoConRef('t-home', 'Equipo Casa');
    const away = await equipoConRef('t-away', 'Equipo Fuera');
    await db.query(
      `INSERT INTO matches (season_id, home_team_id, away_team_id, status, source_ref, scheduled_at)
       VALUES ($1,$2,$3,'scheduled','m-existente', NOW())`,
      [seasonId, home, away]);

    const r = await loadMatches(resultOf([
      scraped({ homeTeamRef: 'ghost-xyz', awayTeamRef: 'ghost-abc', sourceRef: 'm-existente', status: 'finished', homeScore: 5, awayScore: 2 }),
    ]), sportId);
    expect(r.upserted).toBe(1);
    const m = (await db.query<{ home_score: number; away_score: number; status: string; home_team_id: string; away_team_id: string }>(
      `SELECT home_score, away_score, status, home_team_id, away_team_id FROM matches WHERE source_ref='m-existente'`)).rows[0]!;
    expect(m.home_score).toBe(5);
    expect(m.away_score).toBe(2);
    expect(m.status).toBe('finished');
    expect(m.home_team_id).toBe(home);  // no cambió los equipos
    expect(m.away_team_id).toBe(away);
    expect(await countMatches()).toBe(1); // no creó fila nueva
  });

  test('T-028 el directo actualiza el marcador por ref pero NO aprende la ref de club (evita cruzar A/B)', async () => {
    const home = await equipoConRef('t-home', 'Equipo Casa');
    const away = await equipoConRef('t-away', 'Equipo Fuera');
    await db.query(
      `INSERT INTO matches (season_id, home_team_id, away_team_id, status, source_ref, scheduled_at)
       VALUES ($1,$2,$3,'live','m-directo', NOW())`,
      [seasonId, home, away]);

    // El feed de directo identifica por club_id (fep_club_*), que no resuelve.
    await db.query(`UPDATE teams SET short_name = 'YA' WHERE id = $1`, [away]); // ya tiene abreviatura
    const r = await loadMatches(resultOf([
      scraped({ homeTeamRef: 'fep_club_777', awayTeamRef: 'fep_club_888', sourceRef: 'm-directo', status: 'live', homeScore: 1, awayScore: 0, homeTeamAbbr: 'CAS', awayTeamAbbr: 'FUE' }),
    ]), sportId);

    // El marcador SÍ se actualiza (el partido ya existía con la ref del feed).
    expect(r.upserted).toBe(1);
    const m = (await db.query<{ home_score: number }>(`SELECT home_score FROM matches WHERE source_ref='m-directo'`)).rows[0]!;
    expect(m.home_score).toBe(1);

    // La ref de club NO se aprende como alias GLOBAL de equipo (identifica al
    // CLUB y cruzaría A/B), pero SÍ se aprende ACOTADA por competición (un club
    // = un equipo por competición): es la que desempata partidos simultáneos.
    const alt = (await db.query<{ alt_source_refs: string[] }>(`SELECT alt_source_refs FROM teams WHERE id=$1`, [home])).rows[0]!;
    expect(alt.alt_source_refs).not.toContain('fep_club_777');
    const mapaGlobal = (await db.query<{ c: string }>(
      `SELECT count(*)::int c FROM source_entity_map WHERE source_id=$1 AND source_ref='fep_club_777'`,
      [sourceId])).rows[0]!;
    expect(Number(mapaGlobal.c)).toBe(0);

    const mapaClub = (await db.query<{ c: string }>(
      `SELECT count(*)::int c FROM source_club_map WHERE source_id=$1 AND club_ref='fep_club_777' AND team_id=$2`,
      [sourceId, home])).rows[0]!;
    expect(Number(mapaClub.c)).toBe(1);

    // La abreviatura del feed rellena short_name SOLO si falta.
    const tn = (await db.query<{ short_name: string | null }>(
      `SELECT short_name FROM teams WHERE id=$1`, [home])).rows[0]!;
    expect(tn.short_name).toBe('CAS');
    const tnAway = (await db.query<{ short_name: string | null }>(
      `SELECT short_name FROM teams WHERE id=$1`, [away])).rows[0]!;
    expect(tnAway.short_name).toBe('YA'); // no se pisa la que ya tenía
  });

  test('T-024c desempata partidos SIMULTÁNEOS de la misma liga con el mapa de club', async () => {
    const compId = (await db.query<{ id: string }>(`SELECT id FROM competitions LIMIT 1`)).rows[0]!.id;
    await db.query(`UPDATE competitions SET name = 'OK LIGA PLATA SUR' WHERE id = $1`, [compId]);
    const noiaB = await equipoConRef('3685', 'CE NOIA FREIXENET B');
    const vic = await equipoConRef('3727', 'AUTO VIGATANA PATI VIC');
    const acordesB = await equipoConRef('3673', 'ACORDES B');
    const cdmB = await equipoConRef('3714', 'CDM HOCKEY PATINES B');
    const fecha = '2026-10-03T15:30:00.000Z';

    const ins = await db.query<{ id: string }>(
      `INSERT INTO matches (season_id, home_team_id, away_team_id, scheduled_at, status, source_ref)
       VALUES ($1,$2,$3,$4,'scheduled',$5), ($1,$6,$7,$4,'scheduled',$8)
       RETURNING id`,
      [seasonId, noiaB, vic, fecha, `synthetic:${seasonId}:3685:3727:${fecha}`,
       acordesB, cdmB, `synthetic:${seasonId}:3673:3714:${fecha}`]);
    const idNoia = ins.rows[0]!.id;
    const idAcordes = ins.rows[1]!.id;

    // El mapa ya conoce los clubes del partido de ACORDES en esta competición.
    await learnSourceClub(sourceId, compId, 'fep_club_10', acordesB);
    await learnSourceClub(sourceId, compId, 'fep_club_20', cdmB);

    const r = await loadMatches(resultOf([
      scraped({
        homeTeamRef: 'fep_club_10',
        awayTeamRef: 'fep_club_20',
        competitionName: 'OK LIGA PLATA SUR',
        scheduledAt: fecha,
        sourceRef: 'fep_match_99999',
        status: 'live',
        homeScore: 2,
        awayScore: 1,
      }),
    ]), sportId);

    expect(r.upserted).toBe(1);
    const adoptado = (await db.query<{ source_ref: string; home_score: number }>(`SELECT source_ref, home_score FROM matches WHERE id=$1`, [idAcordes])).rows[0]!;
    expect(adoptado.source_ref).toBe('fep_match_99999'); // el correcto, no el otro
    expect(adoptado.home_score).toBe(2);
    // El simultáneo del otro club NO se toca.
    const intacto = (await db.query<{ source_ref: string }>(`SELECT source_ref FROM matches WHERE id=$1`, [idNoia])).rows[0]!;
    expect(intacto.source_ref.startsWith('synthetic:')).toBe(true);
  });

  // ── #151: el feed GLOBAL de directo no debe insertar en la temporada de fallback
  //    un partido cuyos equipos no pertenecen a esa temporada.
  test('T-029 requireTeamsInSeason: no inserta si los equipos no están en la temporada', async () => {
    await equipoConRef('t-home', 'Equipo Casa');
    await equipoConRef('t-away', 'Equipo Fuera');
    // Sin season_teams: los equipos juegan en otra competición/temporada.
    const r = await loadMatches(resultOf([
      scraped({ homeTeamRef: 't-home', awayTeamRef: 't-away', sourceRef: 'm-otra-temporada', status: 'live', homeScore: 1, awayScore: 0, scheduledAt: new Date().toISOString() }),
    ]), sportId, { requireTeamsInSeason: true });

    expect(r.skipped).toBe(1);
    expect(r.upserted).toBe(0);
    expect(await countMatches(`WHERE source_ref = $1`, ['m-otra-temporada'])).toBe(0);
  });

  test('T-029d temporada nueva: equipos de OTRA temporada + placeholder sin idp → se adopta por competición+fecha', async () => {
    // OK Liga 31/10/2026: el feed trae el club, que resuelve al equipo (de la
    // temporada pasada); la temporada de fallback no es la del partido y el
    // calendario aún no publica el idp. Antes se omitía y nunca había directo.
    const compId = (await db.query<{ id: string }>(`SELECT id FROM competitions LIMIT 1`)).rows[0]!.id;
    await db.query(`UPDATE competitions SET name = 'OK Liga Masculina' WHERE id = $1`, [compId]);
    const viejoHome = await equipoConRef('fep_club_72', 'REUS viejo');
    const viejoAway = await equipoConRef('fep_club_68', 'CALAFELL viejo');
    const nuevoHome = await equipoConRef('3711', 'REUS DEPORTIU BRASILIA');
    const nuevoAway = await equipoConRef('3690', 'CALAFELL LA MENORQUINA');
    const fecha = '2026-10-31T15:10:00.000Z';
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO matches (season_id, home_team_id, away_team_id, scheduled_at, status, source_ref)
       VALUES ($1,$2,$3,$4,'scheduled',$5) RETURNING id`,
      [seasonId, nuevoHome, nuevoAway, fecha, `synthetic:${seasonId}:3711:3690:${fecha}`]);

    // Temporada de fallback distinta (otra competición activa).
    const otra = await crearTemporada(await crearCompeticion(sportId), { esActual: true });
    const r = await loadMatches(resultOf([
      scraped({
        seasonId: otra, homeTeamRef: 'fep_club_72', awayTeamRef: 'fep_club_68',
        competitionName: 'OK LIGA MASCULINA', scheduledAt: fecha,
        sourceRef: 'fep_match_34441', status: 'live', homeScore: 1, awayScore: 0,
      }),
    ]), sportId, { requireTeamsInSeason: true });

    expect(r.upserted).toBe(1);
    const row = (await db.query<{ source_ref: string; status: string; home_score: number; started_at: Date | null }>(
      `SELECT source_ref, status, home_score, started_at FROM matches WHERE id=$1`, [rows[0]!.id])).rows[0]!;
    expect(row).toMatchObject({ source_ref: 'fep_match_34441', status: 'live', home_score: 1 });
    expect(row.started_at).not.toBeNull();
    // Ni duplicado ni partido con los equipos viejos.
    expect(await countMatches(`WHERE home_team_id = $1`, [viejoHome])).toBe(0);
    void viejoAway;
  });

  test('T-029b requireTeamsInSeason: inserta si ambos equipos pertenecen a la temporada', async () => {
    const home = await equipoConRef('t-home', 'Equipo Casa');
    const away = await equipoConRef('t-away', 'Equipo Fuera');
    await db.query(
      `INSERT INTO season_teams (season_id, team_id) VALUES ($1,$2), ($1,$3)`,
      [seasonId, home, away]);

    const r = await loadMatches(resultOf([
      scraped({ homeTeamRef: 't-home', awayTeamRef: 't-away', sourceRef: 'm-misma-temporada', status: 'live', homeScore: 1, awayScore: 0, scheduledAt: new Date().toISOString() }),
    ]), sportId, { requireTeamsInSeason: true });

    expect(r.upserted).toBe(1);
    expect(await countMatches(`WHERE source_ref = $1`, ['m-misma-temporada'])).toBe(1);
  });

  test('T-029c requireTeamsInSeason: si el partido ya existe, actualiza el marcador aunque falten season_teams', async () => {
    const home = await equipoConRef('t-home', 'Equipo Casa');
    const away = await equipoConRef('t-away', 'Equipo Fuera');
    await db.query(
      `INSERT INTO matches (season_id, home_team_id, away_team_id, status, source_ref, scheduled_at)
       VALUES ($1,$2,$3,'scheduled','m-global-existente', NOW())`,
      [seasonId, home, away]);

    const r = await loadMatches(resultOf([
      scraped({ homeTeamRef: 't-home', awayTeamRef: 't-away', sourceRef: 'm-global-existente', status: 'finished', homeScore: 4, awayScore: 2 }),
    ]), sportId, { requireTeamsInSeason: true });

    expect(r.upserted).toBe(1);
    const m = (await db.query<{ home_score: number; status: string }>(
      `SELECT home_score, status FROM matches WHERE source_ref = 'm-global-existente'`)).rows[0]!;
    expect(m.home_score).toBe(4);
    expect(m.status).toBe('finished');
    expect(await countMatches()).toBe(1); // no crea fila nueva
  });

  // ── #189: el flujo live debe poblar started_at/finished_at (hoy quedan NULL).
  test('T-030 stampLiveTimes: fija started_at al verlo live, finished_at al finalizar, idempotente', async () => {
    await equipoConRef('t-home', 'Equipo Casa');
    await equipoConRef('t-away', 'Equipo Fuera');
    const kickoff = new Date('2026-09-27T18:00:00.000Z');

    const r1 = await loadMatches(resultOf([
      scraped({ homeTeamRef: 't-home', awayTeamRef: 't-away', sourceRef: 'm-live-1', status: 'live', homeScore: 1, awayScore: 0, scheduledAt: kickoff.toISOString(), scrapedAt: kickoff }),
    ]), sportId, { stampLiveTimes: true });
    expect(r1.upserted).toBe(1);
    const a = (await db.query<{ started_at: Date | null; finished_at: Date | null }>(
      `SELECT started_at, finished_at FROM matches WHERE source_ref = 'm-live-1'`)).rows[0]!;
    expect(a.started_at).not.toBeNull();
    expect(a.finished_at).toBeNull();

    // Re-scrape en vivo más tarde: NO se pisa started_at (idempotente).
    await loadMatches(resultOf([
      scraped({ homeTeamRef: 't-home', awayTeamRef: 't-away', sourceRef: 'm-live-1', status: 'live', homeScore: 2, awayScore: 0, scheduledAt: kickoff.toISOString(), scrapedAt: new Date(kickoff.getTime() + 60_000) }),
    ]), sportId, { stampLiveTimes: true });
    const b = (await db.query<{ started_at: Date | null }>(
      `SELECT started_at FROM matches WHERE source_ref = 'm-live-1'`)).rows[0]!;
    expect(b.started_at!.toISOString()).toBe(a.started_at!.toISOString());

    // Finaliza: finished_at poblado y started_at intacto.
    await loadMatches(resultOf([
      scraped({ homeTeamRef: 't-home', awayTeamRef: 't-away', sourceRef: 'm-live-1', status: 'finished', homeScore: 2, awayScore: 1, scheduledAt: kickoff.toISOString(), scrapedAt: new Date(kickoff.getTime() + 3_600_000) }),
    ]), sportId, { stampLiveTimes: true });
    const c = (await db.query<{ started_at: Date | null; finished_at: Date | null }>(
      `SELECT started_at, finished_at FROM matches WHERE source_ref = 'm-live-1'`)).rows[0]!;
    expect(c.finished_at).not.toBeNull();
    expect(c.started_at!.toISOString()).toBe(a.started_at!.toISOString());
  });

  // ── #188: una regresión de estado no se bloquea (se corrige), pero se detecta.
  test('T-032 regresión finished → scheduled: se aplica el nuevo estado (no se bloquea)', async () => {
    const home = await equipoConRef('t-home', 'Equipo Casa');
    const away = await equipoConRef('t-away', 'Equipo Fuera');
    await db.query(
      `INSERT INTO matches (season_id, home_team_id, away_team_id, status, source_ref, scheduled_at)
       VALUES ($1,$2,$3,'finished','m-reg-1', NOW())`,
      [seasonId, home, away]);

    const r = await loadMatches(resultOf([
      scraped({ homeTeamRef: 't-home', awayTeamRef: 't-away', sourceRef: 'm-reg-1', status: 'scheduled' }),
    ]), sportId);

    expect(r.upserted).toBe(1);
    const m = (await db.query<{ status: string }>(
      `SELECT status FROM matches WHERE source_ref = 'm-reg-1'`)).rows[0]!;
    expect(m.status).toBe('scheduled'); // el glitch se registra, no se congela el dato
  });

  // #229: guarda anti-cruce — un ALTA con fecha fuera de la ventana de su
  // temporada se rechaza (fue el mecanismo de los 4 partidos de 2026/27
  // colgando de la 2025/26). Temporadas sin fechas no se guardan.
  test('#229 alta con scheduled_at fuera de la ventana de temporada → rechazada', async () => {
    await equipoConRef('t-home', 'Equipo Casa');
    await equipoConRef('t-away', 'Equipo Fuera');
    // Ventana 2025/26 con margen de 45 días: noviembre 2026 está FUERA.
    await db.query(
      `UPDATE seasons SET start_date = '2025-09-01', end_date = '2026-06-15' WHERE id = $1`,
      [seasonId]
    );

    const r = await loadMatches(resultOf([
      scraped({
        homeTeamRef: 't-home', awayTeamRef: 't-away', sourceRef: 'm-fuera-1',
        status: 'scheduled', scheduledAt: '2026-11-15T18:00:00Z',
      }),
    ]), sportId);

    expect(r.upserted).toBe(0);
    expect(r.skipped).toBe(1);
    expect(await countMatches()).toBe(0);
  });

  test('#229 alta dentro de la ventana (+margen) pasa', async () => {
    await equipoConRef('t-home', 'Equipo Casa');
    await equipoConRef('t-away', 'Equipo Fuera');
    await db.query(
      `UPDATE seasons SET start_date = '2025-09-01', end_date = '2026-06-15' WHERE id = $1`,
      [seasonId]
    );

    const r = await loadMatches(resultOf([
      scraped({
        homeTeamRef: 't-home', awayTeamRef: 't-away', sourceRef: 'm-dentro-1',
        status: 'scheduled', scheduledAt: '2026-07-10T18:00:00Z', // end + 25d < 45d
      }),
    ]), sportId);

    expect(r.upserted).toBe(1);
    expect(await countMatches()).toBe(1);
  });

  test('#229 un partido YA EXISTENTE fuera de ventana se actualiza (solo warn)', async () => {
    const home = await equipoConRef('t-home', 'Equipo Casa');
    const away = await equipoConRef('t-away', 'Equipo Fuera');
    await db.query(
      `UPDATE seasons SET start_date = '2025-09-01', end_date = '2026-06-15' WHERE id = $1`,
      [seasonId]
    );
    await db.query(
      `INSERT INTO matches (season_id, home_team_id, away_team_id, status, source_ref, scheduled_at)
       VALUES ($1,$2,$3,'scheduled','m-fuera-2', '2026-11-15T18:00:00Z')`,
      [seasonId, home, away]);

    const r = await loadMatches(resultOf([
      scraped({
        homeTeamRef: 't-home', awayTeamRef: 't-away', sourceRef: 'm-fuera-2',
        status: 'live', homeScore: 1, awayScore: 0, scheduledAt: '2026-11-15T18:00:00Z',
      }),
    ]), sportId);

    // No se rechaza: es un UPDATE de marcador/estado, no un alta.
    expect(r.upserted).toBe(1);
    const m = (await db.query<{ status: string }>(
      `SELECT status FROM matches WHERE source_ref = 'm-fuera-2'`)).rows[0]!;
    expect(m.status).toBe('live');
  });
});
