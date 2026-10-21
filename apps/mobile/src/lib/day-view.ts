import { importanceRank } from './competition-importance';
import { isEffectivelyLive } from './time';
import type { MatchSummary } from './api/types';

export const APP_TZ = 'Europe/Madrid';

const DATE_KEY_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: APP_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Clave de día "YYYY-MM-DD" de un instante UTC expresado en hora peninsular de Madrid. */
export function madridDateKey(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return DATE_KEY_FMT.format(d);
}

/** Clave de "hoy" anclada en Madrid. */
export function madridTodayKey(now: Date = new Date()): string {
  return DATE_KEY_FMT.format(now);
}

/** Suma delta días a una clave YYYY-MM-DD sin afectación por cambio de hora. */
export function addDaysToKey(key: string, delta: number): string {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/** Diferencia en días entre claves a - b. */
export function dayDiff(a: string, b: string): number {
  const ta = Date.parse(`${a}T12:00:00Z`);
  const tb = Date.parse(`${b}T12:00:00Z`);
  return Math.round((ta - tb) / 86_400_000);
}

/** Genera la lista de claves de fechas centradas en todayKey. */
export function buildDateKeys(todayKey: string, before = 7, after = 14): string[] {
  const keys: string[] = [];
  for (let i = -before; i <= after; i++) keys.push(addDaysToKey(todayKey, i));
  return keys;
}

export function labelDate(key: string): Date {
  return new Date(`${key}T12:00:00`);
}

export function getRelativeKey(key: string, todayKey: string): string | null {
  const diff = dayDiff(key, todayKey);
  if (diff === -1) return 'common.yesterday';
  if (diff === 0) return 'common.today';
  if (diff === 1) return 'common.tomorrow';
  return null;
}

const WEEKDAY_FMT = new Map<string, Intl.DateTimeFormat>();
const MONTH_FMT = new Map<string, Intl.DateTimeFormat>();

export function dayAbbr(date: Date, locale = 'es'): string {
  let fmt = WEEKDAY_FMT.get(locale);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: APP_TZ });
    WEEKDAY_FMT.set(locale, fmt);
  }
  return fmt.format(date).replace('.', '').slice(0, 3);
}

export function monthAbbr(date: Date, locale = 'es'): string {
  let fmt = MONTH_FMT.get(locale);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat(locale, { month: 'short', timeZone: APP_TZ });
    MONTH_FMT.set(locale, fmt);
  }
  return fmt.format(date).replace('.', '').slice(0, 3);
}

export type DayFilter = 'all' | 'live' | 'following';

export interface CompetitionBlock<T> {
  key: string;
  id: string | null;
  name: string | null;
  slug: string | null;
  followed: boolean;
  matches: T[];
}

export interface DayView<T> {
  dayKey: string;
  total: number;
  liveCount: number;
  followingCount: number;
  filter: DayFilter;
  myTeams: T[];
  competitions: CompetitionBlock<T>[];
}

export interface DayViewOptions {
  dayKey: string;
  teamIds?: readonly string[];
  leagueIds?: readonly string[];
  filter?: DayFilter;
  locale?: string;
}

function timeOf(m: MatchSummary): number {
  const t = Date.parse(m.scheduledAt ?? m.startedAt ?? '');
  return Number.isFinite(t) ? t : 0;
}

function byTime(a: MatchSummary, b: MatchSummary): number {
  const d = timeOf(a) - timeOf(b);
  return d !== 0 ? d : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** La jornada de un día para la app móvil: filtrada, agrupada y ordenada. */
export function buildDayView<T extends MatchSummary>(matches: T[], opts: DayViewOptions): DayView<T> {
  const teams = new Set(opts.teamIds ?? []);
  const leagues = new Set(opts.leagueIds ?? []);
  const locale = opts.locale ?? 'es';

  const isMyTeam = (m: T) => teams.has(m.homeTeam.id) || teams.has(m.awayTeam.id);
  const isFollowedLeague = (m: T) => Boolean(m.competitionId && leagues.has(m.competitionId));
  const isFollowing = (m: T) => isMyTeam(m) || isFollowedLeague(m);
  const isLive = (m: T) => isEffectivelyLive(m.status, m.scheduledAt);

  const day = matches.filter((m) => madridDateKey(m.scheduledAt) === opts.dayKey);
  const liveCount = day.filter(isLive).length;
  const followingCount = day.filter(isFollowing).length;

  let filter: DayFilter = opts.filter ?? 'all';
  if ((filter === 'live' && liveCount === 0) || (filter === 'following' && followingCount === 0)) {
    filter = 'all';
  }
  const visible =
    filter === 'live'
      ? day.filter(isLive)
      : filter === 'following'
        ? day.filter(isFollowing)
        : day;

  const myTeams: T[] = [];
  const blocks = new Map<string, CompetitionBlock<T>>();
  for (const m of visible) {
    if (isMyTeam(m)) {
      myTeams.push(m);
      continue;
    }
    const key = m.competitionId || m.competitionName || 'other';
    let block = blocks.get(key);
    if (!block) {
      block = {
        key,
        id: m.competitionId ?? null,
        name: m.competitionName ?? null,
        slug: m.competitionSlug ?? null,
        followed: isFollowedLeague(m),
        matches: [],
      };
      blocks.set(key, block);
    }
    block.matches.push(m);
  }

  myTeams.sort(byTime);
  const competitions = [...blocks.values()];
  for (const b of competitions) b.matches.sort(byTime);
  competitions.sort((a, b) => {
    if (a.followed !== b.followed) return a.followed ? -1 : 1;
    if ((a.name === null) !== (b.name === null)) return a.name === null ? 1 : -1;
    const d = importanceRank(a.slug) - importanceRank(b.slug);
    return d !== 0 ? d : (a.name ?? '').localeCompare(b.name ?? '', locale);
  });

  return { dayKey: opts.dayKey, total: day.length, liveCount, followingCount, filter, myTeams, competitions };
}

/** Días que tienen al menos un partido. */
export function daysWithMatches(matches: readonly MatchSummary[]): Set<string> {
  const out = new Set<string>();
  for (const m of matches) {
    const k = madridDateKey(m.scheduledAt);
    if (k) out.add(k);
  }
  return out;
}

/** Próxima jornada disponible posterior a afterKey. */
export function nextMatchday<T extends MatchSummary>(
  matches: T[],
  afterKey: string,
  opts: Omit<DayViewOptions, 'dayKey' | 'filter'> = {},
): DayView<T> | null {
  let next: string | null = null;
  for (const m of matches) {
    const k = madridDateKey(m.scheduledAt);
    if (k && k > afterKey && (next === null || k < next)) next = k;
  }
  return next === null ? null : buildDayView(matches, { ...opts, dayKey: next, filter: 'all' });
}
