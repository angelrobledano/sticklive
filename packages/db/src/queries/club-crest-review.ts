/**
 * A4 — Revisión de clubes por escudo (panel /admin/clubes).
 *
 * El backfill `backfill-clubs-by-crest` agrupa equipos por el fichero del
 * escudo (= id de club sidgad) y los cuelga de un club. Antes de lanzarlo con
 * --write, una persona tiene que poder ver cada grupo: qué equipos entran, de
 * qué temporadas son y si hay clubes duplicados que se fusionarían. Solo lee.
 */
import { db } from '../client.js';
import { clubKeyFromLogo, crestPortal } from '@sports/shared-types';

export type CrestGroupStatus = 'merge' | 'pending' | 'ok';

export interface CrestReviewTeam {
  id: string;
  name: string;
  gender: string | null;
  ageCategory: string | null;
  clubId: string | null;
  clubName: string | null;
  matches: number;
  lastSeason: string | null;
  lastCompetition: string | null;
}

export interface CrestReviewGroup {
  key: string;
  portal: string;
  crestUrl: string;
  /** merge: varios clubes con el mismo escudo · pending: equipos sin club · ok: todo en un club. */
  status: CrestGroupStatus;
  clubs: Array<{ id: string; name: string }>;
  teams: CrestReviewTeam[];
}

const ORDER: Record<CrestGroupStatus, number> = { merge: 0, pending: 1, ok: 2 };

export async function listCrestReviewGroups(opts: { onlyIssues?: boolean } = {}): Promise<CrestReviewGroup[]> {
  const { rows } = await db.query<{
    id: string; name: string; logo_url: string; gender: string | null; age_category: string | null;
    club_id: string | null; club_name: string | null; matches: number; last_season: string | null; last_competition: string | null;
  }>(`
    SELECT t.id, t.name, t.logo_url, t.gender, t.age_category, t.club_id, cl.canonical_name AS club_name,
           (SELECT count(*)::int FROM matches m WHERE m.home_team_id = t.id OR m.away_team_id = t.id) AS matches,
           ls.name AS last_season, ls.competition AS last_competition
      FROM teams t
      LEFT JOIN clubs cl ON cl.id = t.club_id
      LEFT JOIN LATERAL (
        SELECT s.name, c.name AS competition
          FROM season_teams st
          JOIN seasons s ON s.id = st.season_id
          JOIN competitions c ON c.id = s.competition_id
         WHERE st.team_id = t.id
         ORDER BY s.start_date DESC NULLS LAST, s.name DESC
         LIMIT 1
      ) ls ON TRUE
     WHERE t.logo_url IS NOT NULL
     ORDER BY t.name`);

  const groups = new Map<string, CrestReviewGroup>();
  for (const r of rows) {
    const clubKey = clubKeyFromLogo(r.logo_url);
    const portal = crestPortal(r.logo_url);
    if (!clubKey || !portal) continue;
    const key = `${portal}:${clubKey}`;
    const g = groups.get(key) ?? { key, portal, crestUrl: r.logo_url, status: 'ok' as CrestGroupStatus, clubs: [], teams: [] };
    g.teams.push({
      id: r.id, name: r.name, gender: r.gender, ageCategory: r.age_category, clubId: r.club_id, clubName: r.club_name,
      matches: r.matches, lastSeason: r.last_season, lastCompetition: r.last_competition,
    });
    if (r.club_id && !g.clubs.some((c) => c.id === r.club_id)) g.clubs.push({ id: r.club_id, name: r.club_name ?? '' });
    groups.set(key, g);
  }

  const out: CrestReviewGroup[] = [];
  for (const g of groups.values()) {
    g.status = g.clubs.length > 1 ? 'merge' : g.teams.some((t) => !t.clubId) ? 'pending' : 'ok';
    // Un equipo solo y ya en su club no necesita revisión.
    if (opts.onlyIssues && g.status === 'ok') continue;
    if (g.teams.length === 1 && g.status !== 'merge' && g.teams[0]!.clubId) continue;
    out.push(g);
  }
  return out.sort((a, b) => ORDER[a.status] - ORDER[b.status] || b.teams.length - a.teams.length || a.key.localeCompare(b.key));
}
