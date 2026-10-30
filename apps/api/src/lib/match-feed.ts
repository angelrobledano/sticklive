/**
 * Visibilidad en Partidos para `GET /matches/current` (spec 2026-10-30).
 *
 *   scope=all        (por defecto) todo el rango, como siempre.
 *   scope=feed       destacadas + lo que sigue el usuario; `hiddenCount` dice
 *                    cuántos partidos del rango quedan fuera («otras
 *                    competiciones», a un toque).
 *   scope=following  solo lo seguido (Mi grada, Favoritos).
 *
 * La regla es `feedReason` de @sports/shared-types: la misma que usan la web y
 * la app. Se aplica en memoria sobre el resultado ya cacheado por rango, así
 * que no hay una segunda definición en SQL ni consultas nuevas.
 */
import { splitFeed, feedReason, type FeedFollows } from '@sports/shared-types';

export type FeedScope = 'all' | 'feed' | 'following';

export interface FeedQuery {
  scope: FeedScope;
  teamIds: string[];
  leagueIds: string[];
  country: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_IDS = 200;

function ids(raw: string | undefined): string[] {
  if (!raw) return [];
  return [...new Set(raw.split(',').map((s) => s.trim()).filter((s) => UUID.test(s)))].slice(0, MAX_IDS);
}

export function parseFeedQuery(q: { scope?: string; teams?: string; leagues?: string; country?: string }): FeedQuery {
  const scope: FeedScope = q.scope === 'feed' || q.scope === 'following' ? q.scope : 'all';
  const country = /^[a-z]{2}$/i.test(q.country ?? '') ? q.country!.toUpperCase() : null;
  return { scope, teamIds: ids(q.teams), leagueIds: ids(q.leagues), country };
}

interface Row {
  id: string;
  scheduledAt?: string | Date | null;
  homeTeam: { id: string | null };
  awayTeam: { id: string | null };
  competitionId: string | null;
  competitionFeaturedRank: number | null;
  competitionTier: number | null;
  competitionCountry: string | null;
}

const asFeedMatch = (m: Row) => ({
  id: m.id,
  homeTeamId: m.homeTeam.id ?? '',
  awayTeamId: m.awayTeam.id ?? '',
  competitionId: m.competitionId,
  competitionFeaturedRank: m.competitionFeaturedRank,
  competitionTier: m.competitionTier,
  competitionCountry: m.competitionCountry,
});

/**
 * Partidos fuera del feed por hora UTC («2026-10-31T16»). El cliente pide su
 * día con margen (otra zona horaria) y suma solo las horas que caen en su día:
 * así «Ver otras competiciones (N)» cuenta el día de quien mira, no el rango.
 */
function byHour(rows: Row[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    if (!r.scheduledAt) continue;
    const d = new Date(r.scheduledAt);
    if (Number.isNaN(d.getTime())) continue;
    const k = d.toISOString().slice(0, 13);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

export interface ScopedMatches<T> {
  matches: T[];
  hiddenCount: number;
  hiddenByHour: Record<string, number>;
}

export function applyFeedScope<T extends Row>(matches: T[], q: FeedQuery): ScopedMatches<T> {
  if (q.scope === 'all') return { matches, hiddenCount: 0, hiddenByHour: {} };
  const follows: FeedFollows = { teamIds: q.teamIds, leagueIds: q.leagueIds, country: q.country };
  if (q.scope === 'following') {
    const out = matches.filter((m) => {
      const r = feedReason(asFeedMatch(m), follows);
      return r === 'team' || r === 'league';
    });
    const kept = new Set(out);
    return { matches: out, hiddenCount: matches.length - out.length, hiddenByHour: byHour(matches.filter((m) => !kept.has(m))) };
  }
  const byId = new Map(matches.map((m) => [m.id, m]));
  const { feed, others } = splitFeed(matches.map(asFeedMatch), follows);
  return {
    matches: feed.map((f) => byId.get(f.id)!),
    hiddenCount: others.length,
    hiddenByHour: byHour(others.map((o) => byId.get(o.id)!)),
  };
}
