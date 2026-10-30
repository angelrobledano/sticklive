import { Hono } from 'hono';
import { db } from '@sports/db';
import { logger } from '@sports/logger';
import { captureRouteError } from '../lib/route-error.js';
import { parseCompetitionKey as parseSlugOrId } from '../lib/competition-key.js';
import { clubSection, orderClubTeams, sectionSuffix, type TeamSectionFields } from '../lib/team-section.js';

/**
 * GET /clubs/:key — ficha de club (Plan B1 de URLs legibles y fichas).
 *
 * `:key` es el slug del club (URL pública) o su UUID (la web responde 308 al
 * slug). Agrupa los equipos del club (club × género × categoría × filial) con
 * su competición actual, y los partidos recientes y próximos de todos ellos.
 */
export const clubDetailRouter = new Hono();

const LIVE_STATUSES = new Set(['live', 'halftime', 'overtime', 'penalty_shootout']);
const MATCH_LIST_LIMIT = 10;

export interface ClubRow {
  id: string;
  slug: string;
  canonical_name: string;
  city: string | null;
  country: string | null;
  crest_url: string | null;
}

export interface ClubTeamDetailRow extends TeamSectionFields {
  id: string;
  name: string;
  short_name: string | null;
  season_id: string | null;
  competition_id: string | null;
  competition_slug: string | null;
  competition_name: string | null;
  is_current: boolean | null;
  position: number | null;
}

export interface ClubMatchRow {
  id: string;
  scheduled_at: Date | string | null;
  status: string;
  home_score: number | null;
  away_score: number | null;
  home_team_id: string;
  home_name: string;
  away_team_id: string;
  away_name: string;
  competition_id: string;
  competition_slug: string | null;
  competition_name: string;
}

export interface ClubMatchDto {
  id: string;
  scheduledAt: string | null;
  status: string;
  homeScore: number | null;
  awayScore: number | null;
  home: { id: string; name: string };
  away: { id: string; name: string };
  competition: { id: string; slug: string | null; name: string };
}

function iso(value: Date | string | null): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function matchDto(r: ClubMatchRow): ClubMatchDto {
  return {
    id: r.id,
    scheduledAt: iso(r.scheduled_at),
    status: r.status,
    homeScore: r.home_score,
    awayScore: r.away_score,
    home: { id: r.home_team_id, name: r.home_name },
    away: { id: r.away_team_id, name: r.away_name },
    competition: { id: r.competition_id, slug: r.competition_slug, name: r.competition_name },
  };
}

/** Partido visto desde un equipo del club: rival, local/visitante y resultado. */
export interface TeamMatchDto {
  id: string;
  scheduledAt: string | null;
  status: string;
  home: boolean;
  opponent: string;
  opponentId: string;
  goalsFor: number | null;
  goalsAgainst: number | null;
  /** V/E/D solo si terminó con marcador. */
  result: 'W' | 'D' | 'L' | null;
}

function teamMatch(m: ClubMatchRow, teamId: string): TeamMatchDto {
  const home = m.home_team_id === teamId;
  const gf = home ? m.home_score : m.away_score;
  const ga = home ? m.away_score : m.home_score;
  const done = m.status === 'finished' && gf != null && ga != null;
  return {
    id: m.id,
    scheduledAt: iso(m.scheduled_at),
    status: m.status,
    home,
    opponent: home ? m.away_name : m.home_name,
    opponentId: home ? m.away_team_id : m.home_team_id,
    goalsFor: gf,
    goalsAgainst: ga,
    result: done ? (gf! > ga! ? 'W' : gf! < ga! ? 'L' : 'D') : null,
  };
}

/**
 * Lógica pura de la ficha: ordena secciones, descarta equipos sin ningún
 * partido visible (fichas vacías) y reparte partidos en recientes y próximos.
 * `indexable` = algún equipo juega en una temporada en curso (matriz de
 * indexación de la auditoría SEO): si no, la web sirve `noindex, follow`.
 */
export function buildClubDetail(club: ClubRow, teams: ClubTeamDetailRow[], matches: ClubMatchRow[]) {
  const visibleTeams = orderClubTeams(teams.filter((t) => t.competition_id !== null));

  const recent = matches
    .filter((m) => m.status === 'finished' || LIVE_STATUSES.has(m.status))
    .sort((a, b) => (iso(b.scheduled_at) ?? '').localeCompare(iso(a.scheduled_at) ?? ''))
    .slice(0, MATCH_LIST_LIMIT)
    .map(matchDto);
  const upcoming = matches
    .filter((m) => m.status === 'scheduled')
    .sort((a, b) => (iso(a.scheduled_at) ?? '').localeCompare(iso(b.scheduled_at) ?? ''))
    .slice(0, MATCH_LIST_LIMIT)
    .map(matchDto);

  return {
    club: {
      id: club.id,
      slug: club.slug,
      name: club.canonical_name,
      city: club.city,
      country: club.country,
      crestUrl: club.crest_url,
    },
    teams: visibleTeams.map((t) => ({
      id: t.id,
      name: t.name,
      shortName: t.short_name,
      gender: t.gender ?? null,
      ageCategory: t.age_category ?? null,
      squadLevel: t.squad_level ?? null,
      sectionSuffix: sectionSuffix(t),
      competition: t.competition_id
        ? { id: t.competition_id, slug: t.competition_slug, name: t.competition_name ?? '', seasonId: t.season_id, isCurrent: t.is_current === true }
        : null,
      position: t.position,
      // Sección y partidos del equipo (spec 2026-10-30, referencia OKmob).
      section: clubSection(t),
      lastMatch: (() => {
        const m = matches
          .filter((x) => (x.home_team_id === t.id || x.away_team_id === t.id) && (x.status === 'finished' || LIVE_STATUSES.has(x.status)))
          .sort((a, b) => (iso(b.scheduled_at) ?? '').localeCompare(iso(a.scheduled_at) ?? ''))[0];
        return m ? teamMatch(m, t.id) : null;
      })(),
      nextMatch: (() => {
        const m = matches
          .filter((x) => (x.home_team_id === t.id || x.away_team_id === t.id) && x.status === 'scheduled')
          .sort((a, b) => (iso(a.scheduled_at) ?? '').localeCompare(iso(b.scheduled_at) ?? ''))[0];
        return m ? teamMatch(m, t.id) : null;
      })(),
    })),
    recent,
    upcoming,
    indexable: visibleTeams.some((t) => t.is_current === true),
  };
}

clubDetailRouter.get('/:key', async (c) => {
  const key = parseSlugOrId(c.req.param('key'));
  if (!key) return c.json({ error: 'Not found' }, 404);

  try {
    const clubRes = await db.query<ClubRow>(
      `SELECT id, slug, canonical_name, city, country, crest_url
         FROM clubs
        WHERE ${key.by === 'id' ? 'id = $1' : 'slug = $1'}`,
      [key.value],
    );
    let club = clubRes.rows[0];
    // Slug antiguo (club renombrado desde /admin, migración 093): se sirve el
    // club actual y la web responde 308 a su slug vigente.
    if (!club && key.by === 'slug') {
      const moved = await db.query<ClubRow>(
        `SELECT cl.id, cl.slug, cl.canonical_name, cl.city, cl.country, cl.crest_url
           FROM club_slug_redirects r
           JOIN clubs cl ON cl.id = r.club_id
          WHERE r.old_slug = $1`,
        [key.value],
      );
      club = moved.rows[0];
    }
    if (!club) return c.json({ error: 'Club not found' }, 404);

    const [teamsRes, matchesRes] = await Promise.all([
      // Competición "actual" de cada sección: la temporada en curso si juega en
      // ella; si no, la más reciente con partidos visibles.
      db.query<ClubTeamDetailRow>(`
        SELECT t.id, COALESCE(t.display_name, t.name) AS name, t.short_name,
               t.gender, t.age_category, t.squad_level, t.team_type,
               cur.season_id, cur.competition_id, cur.competition_slug,
               cur.competition_name, cur.is_current, st.position
          FROM teams t
          LEFT JOIN LATERAL (
            SELECT se.id AS season_id, c.id AS competition_id, c.slug AS competition_slug,
                   c.name AS competition_name, se.is_current
              FROM matches m
              JOIN seasons se     ON se.id = m.season_id
              JOIN competitions c ON c.id = se.competition_id
             WHERE (m.home_team_id = t.id OR m.away_team_id = t.id)
               AND se.data_quality = 'ok'
               AND c.data_quality = 'ok'
             ORDER BY se.is_current DESC, se.start_date DESC NULLS LAST, c.top_tier DESC
             LIMIT 1
          ) cur ON TRUE
          LEFT JOIN LATERAL (
            SELECT s.position
              FROM standings s
             WHERE s.team_id = t.id AND s.season_id = cur.season_id
             ORDER BY s.position NULLS LAST
             LIMIT 1
          ) st ON TRUE
         WHERE t.club_id = $1
           -- Las selecciones no son secciones de un club (no van en su ficha).
           AND t.team_type = 'club'
      `, [club.id]),
      // Ventana acotada (-60/+30 días) para que un club grande no recorra todo
      // su histórico; la ficha solo enseña los 10 últimos y los 10 próximos.
      db.query<ClubMatchRow>(`
        SELECT m.id, m.scheduled_at, m.status, m.home_score, m.away_score,
               m.home_team_id, COALESCE(ht.display_name, ht.name) AS home_name,
               m.away_team_id, COALESCE(at.display_name, at.name) AS away_name,
               c.id AS competition_id, c.slug AS competition_slug, c.name AS competition_name
          FROM matches m
          JOIN teams ht       ON ht.id = m.home_team_id
          JOIN teams at       ON at.id = m.away_team_id
          JOIN seasons se     ON se.id = m.season_id
          JOIN competitions c ON c.id = se.competition_id
         WHERE ((ht.club_id = $1 AND ht.team_type = 'club') OR (at.club_id = $1 AND at.team_type = 'club'))
           AND se.data_quality = 'ok'
           AND c.data_quality = 'ok'
           AND m.scheduled_at > NOW() - INTERVAL '60 days'
           AND m.scheduled_at < NOW() + INTERVAL '30 days'
         ORDER BY m.scheduled_at
         LIMIT 600
      `, [club.id]),
    ]);

    return c.json(buildClubDetail(club, teamsRes.rows, matchesRes.rows));
  } catch (err) {
    captureRouteError(err, 'clubs] GET /:key error');
    logger.error({ err }, '[clubs] GET /:key error');
    return c.json({ error: 'Database error' }, 500);
  }
});
