/**
 * match.loader — el loader del directo, con la lógica de más riesgo de
 * duplicados/fantasmas. Corre cada ~45 s en producción. Se prueba llamando a
 * loadMatches() contra Postgres real (arnés compartido, aislamiento por
 * TRUNCATE), ejercitando:
 *   - adopción de placeholders sintéticos (sin duplicar)
 *   - guarda anti-duplicados del placeholder cuando ya existe el real
 *   - omisión del placeholder sintético con fecha pasada
 *   - fallback solo-marcador cuando el equipo no resuelve
 *   - self-heal de alt_source_refs desde el directo (club_id → equipo)
 *
 * Cubre T-023..T-028 de docs/AUDITORIA_TESTS.md.
 */
import { describe, test, expect, beforeEach, afterAll } from 'vitest';
import { db, closeDb } from '@sports/db';
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

  test('T-024 adopta el placeholder sintético cuando llega el partido real (sin duplicar)', async () => {
    const home = await equipoConRef('t-home', 'Equipo Casa');
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

  test('T-028 self-heal: aprende alt_source_ref (club_id → equipo) desde el directo', async () => {
    const home = await equipoConRef('t-home', 'Equipo Casa');
    const away = await equipoConRef('t-away', 'Equipo Fuera');
    await db.query(
      `INSERT INTO matches (season_id, home_team_id, away_team_id, status, source_ref, scheduled_at)
       VALUES ($1,$2,$3,'live','m-directo', NOW())`,
      [seasonId, home, away]);

    // El feed de directo identifica por club_id (fep_club_*), que no resuelve.
    await loadMatches(resultOf([
      scraped({ homeTeamRef: 'fep_club_777', awayTeamRef: 'fep_club_888', sourceRef: 'm-directo', status: 'live', homeScore: 1, awayScore: 0 }),
    ]), sportId);

    const alt = (await db.query<{ alt_source_refs: string[] }>(`SELECT alt_source_refs FROM teams WHERE id=$1`, [home])).rows[0]!;
    expect(alt.alt_source_refs).toContain('fep_club_777');
    const mapa = (await db.query<{ c: string }>(
      `SELECT count(*)::int c FROM source_entity_map WHERE source_id=$1 AND source_ref='fep_club_777' AND team_id=$2`,
      [sourceId, home])).rows[0]!;
    expect(Number(mapa.c)).toBe(1);
  });
});
