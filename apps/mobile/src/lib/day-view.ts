import { importanceRank } from './competition-importance';
import { isEffectivelyLive } from './time';
import { dateKeyIn } from './viewer-tz';
import type { MatchSummary } from './api/types';
import { feedReason } from '@sports/shared-types';

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
  country: string | null;
  logoUrl: string | null;
  tier: number | null;
  featuredRank: number | null;
  followed: boolean;
  /** Sale por defecto (destacada o seguida); false = «otras competiciones». */
  inFeed: boolean;
  matches: T[];
}

export interface DayView<T> {
  dayKey: string;
  /** Partidos del día que salen por defecto. */
  total: number;
  /** Partidos del día cargados que NO salen por defecto. */
  hiddenCount: number;
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
  /** Pinta también las competiciones fuera del feed, detrás. */
  includeOthers?: boolean;
  tz?: string;
  country?: string | null;
}

function timeOf(m: MatchSummary): number {
  const t = Date.parse(m.scheduledAt ?? m.startedAt ?? '');
  return Number.isFinite(t) ? t : 0;
}

function byTime(a: MatchSummary, b: MatchSummary): number {
  const d = timeOf(a) - timeOf(b);
  return d !== 0 ? d : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** 0 = el país preferido, 1 = mundial/sin país, 2 = otro país. */
export function countryRank(blockCountry: string | null, preferred: string): number {
  if (blockCountry === preferred) return 0;
  if (!blockCountry || blockCountry === 'W') return 1;
  return 2;
}

/** La jornada de un día para la app móvil: filtrada, agrupada y ordenada. */
export function buildDayView<T extends MatchSummary>(matches: T[], opts: DayViewOptions): DayView<T> {
  const teams = new Set(opts.teamIds ?? []);
  const leagues = new Set(opts.leagueIds ?? []);
  const locale = opts.locale ?? 'es';
  const tz = opts.tz ?? APP_TZ;
  const country = opts.country ?? null;

  const isMyTeam = (m: T) => teams.has(m.homeTeam.id) || teams.has(m.awayTeam.id);
  const isFollowedLeague = (m: T) => Boolean(m.competitionId && leagues.has(m.competitionId));
  const isFollowing = (m: T) => isMyTeam(m) || isFollowedLeague(m);
  const isLive = (m: T) => isEffectivelyLive(m.status, m.scheduledAt);

  // Visibilidad (spec 2026-10-30): la regla compartida con la web y la API.
  const seen = new Set<string>();
  const all = matches.filter((m) => {
    if (dateKeyIn(m.scheduledAt, tz) !== opts.dayKey || seen.has(m.id)) return false;
    seen.add(m.id);
    return true;
  });
  const follows = { teamIds: opts.teamIds ?? [], leagueIds: opts.leagueIds ?? [], country: null };
  const inFeed = (m: T) => feedReason({ ...m, homeTeamId: m.homeTeam.id, awayTeamId: m.awayTeam.id }, follows) !== null;
  const feedDay = all.filter(inFeed);
  const day = opts.includeOthers ? all : feedDay;
  const liveCount = feedDay.filter(isLive).length;
  const followingCount = feedDay.filter(isFollowing).length;

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
        country: m.competitionCountry ?? null,
        logoUrl: m.competitionLogoUrl ?? null,
        tier: m.competitionTier ?? null,
        featuredRank: m.competitionFeaturedRank ?? null,
        followed: isFollowedLeague(m),
        inFeed: inFeed(m),
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
    if (a.inFeed !== b.inFeed) return a.inFeed ? -1 : 1;
    if (a.followed !== b.followed) return a.followed ? -1 : 1;
    if (country) {
      const c = countryRank(a.country, country) - countryRank(b.country, country);
      if (c !== 0) return c;
    }
    if ((a.name === null) !== (b.name === null)) return a.name === null ? 1 : -1;
    const d = importanceRank({ slug: a.slug, tier: a.tier, featuredRank: a.featuredRank }) -
              importanceRank({ slug: b.slug, tier: b.tier, featuredRank: b.featuredRank });
    return d !== 0 ? d : (a.name ?? '').localeCompare(b.name ?? '', locale);
  });

  return {
    dayKey: opts.dayKey, total: feedDay.length, hiddenCount: all.length - feedDay.length,
    liveCount, followingCount, filter, myTeams, competitions,
  };
}

/** Días que tienen al menos un partido. */
export function daysWithMatches(matches: readonly MatchSummary[], tz: string = APP_TZ): Set<string> {
  const out = new Set<string>();
  for (const m of matches) {
    const k = dateKeyIn(m.scheduledAt, tz);
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
  // Primer día posterior con algo que enseñar por defecto (feed).
  const tz = opts.tz ?? APP_TZ;
  const keys = [...new Set(matches.map((m) => dateKeyIn(m.scheduledAt, tz)))]
    .filter((k) => !!k && k > afterKey)
    .sort();
  for (const k of keys) {
    const v = buildDayView(matches, { ...opts, dayKey: k, filter: 'all' });
    if (v.total > 0) return v;
  }
  return null;
}

/** Máxima categoría: tier 1-2 (migración 089). */
const OPEN_MAX_TIER = 2;

/**
 * Bloques que la home abre por defecto (paridad con web):
 * seguidas, con algún partido en directo, destacadas (`featured_rank`) o de
 * máxima categoría. El resto (base, ligas menores de otros países) se queda
 * plegado con su recuento para no saturar la pantalla.
 * Si ninguno califica, se abre el primero para no dejar todo cerrado.
 */
export function defaultOpenKeys<T extends { status: string; scheduledAt?: string | null }>(
  blocks: readonly {
    key: string;
    country?: string | null;
    followed: boolean;
    tier: number | null;
    featuredRank: number | null;
    matches: readonly T[];
  }[],
  country: string | null = null,
): Set<string> {
  const open = new Set<string>();
  for (const b of blocks) {
    const relevantCountry = !country || countryRank(b.country ?? null, country) < 2;
    if (
      b.followed ||
      b.matches.some((m) => isEffectivelyLive(m.status, m.scheduledAt)) ||
      (relevantCountry && (b.featuredRank != null || (b.tier != null && b.tier <= OPEN_MAX_TIER)))
    ) {
      open.add(b.key);
    }
  }
  if (open.size === 0 && blocks.length > 0) open.add(blocks[0]!.key);
  return open;
}

/**
 * Calcula el desplazamiento horizontal (offset) para centrar un elemento
 * en el centro exacto de la pantalla.
 */
export function computeCenterOffset(
  index: number,
  containerWidth: number,
  itemWidth = 58,
  itemMargin = 6,
  horizontalPadding = 12,
): number {
  if (index < 0 || containerWidth <= 0) return 0;
  const totalItemWidth = itemWidth + itemMargin;
  const itemCenter = horizontalPadding + index * totalItemWidth + itemWidth / 2;
  const targetOffset = itemCenter - containerWidth / 2;
  return Math.max(0, targetOffset);
}

export const SWIPE_THRESHOLD_DX = 50;
export const SWIPE_VELOCITY_THRESHOLD = 0.3;

/**
 * Determina si un gesto táctil debe ser capturado para navegación horizontal de días,
 * garantizando que el scroll vertical de la lista de partidos tenga absoluta prioridad.
 */
export function isHorizontalSwipeGesture(dx: number, dy: number): boolean {
  return Math.abs(dx) > 20 && Math.abs(dx) > Math.abs(dy) * 2;
}

/**
 * Resuelve el cambio de días (-1, 0, +1) según la distancia y velocidad del gesto horizontal:
 * - Arrastre a la izquierda (dx < 0): avanza al día siguiente (+1)
 * - Arrastre a la derecha (dx > 0): retrocede al día anterior (-1)
 * - Gesto insuficiente: 0 (sin cambio)
 */
export function resolveDaySwipeDelta(dx: number, vx: number): -1 | 0 | 1 {
  if (dx < -SWIPE_THRESHOLD_DX || (dx < -25 && vx < -SWIPE_VELOCITY_THRESHOLD)) {
    return 1;
  }
  if (dx > SWIPE_THRESHOLD_DX || (dx > 25 && vx > SWIPE_VELOCITY_THRESHOLD)) {
    return -1;
  }
  return 0;
}

/**
 * Ancho en dp de la zona de guarda lateral para no interceptar los gestos
 * nativos del sistema en Android 15 (Predictive Back Gesture de ambos bordes).
 */
export const ANDROID_BACK_GUARD_DP = 32;

/**
 * Extrae el punto de inicio X del gesto táctil en coordenadas de pantalla.
 * En React Native, PanResponder.gestureState.x0 es 0 antes de que el responder sea concedido
 * (onResponderGrant), por lo que durante la fase de captura/evaluación (onMoveShouldSetPanResponderCapture)
 * se debe derivar del evento nativo (evt.nativeEvent.pageX - gestureState.dx) o moveX.
 */
export function extractGestureStartX(
  evt?: { nativeEvent?: { pageX?: number } } | null,
  gestureState?: { dx?: number; moveX?: number; x0?: number } | null,
): number | undefined {
  if (typeof evt?.nativeEvent?.pageX === 'number') {
    return evt.nativeEvent.pageX - (gestureState?.dx ?? 0);
  }
  if (typeof gestureState?.moveX === 'number' && gestureState.moveX > 0) {
    return gestureState.moveX - (gestureState?.dx ?? 0);
  }
  if (typeof gestureState?.x0 === 'number' && gestureState.x0 > 0) {
    return gestureState.x0;
  }
  return undefined;
}

/**
 * Comprueba si el origen del toque (x0) está fuera de las zonas de guarda de los bordes.
 * Si x0 está dentro de los primeros o últimos guardDp píxeles, devuelve false para que
 * el PanResponder ceda el gesto al sistema operativo (Back predictivo en Android 15).
 * Si no se puede determinar x0 (undefined/null), devuelve true para no impedir el swipe.
 */
export function isOutsideEdgeGuard(
  x0: number | undefined | null,
  screenWidth: number,
  guardDp: number = ANDROID_BACK_GUARD_DP,
): boolean {
  if (screenWidth <= guardDp * 2) return true;
  if (x0 === undefined || x0 === null || Number.isNaN(x0)) return true;
  return x0 >= guardDp && x0 <= screenWidth - guardDp;
}




/**
 * Partidos fuera del feed del día `dayKey` (Madrid) a partir del recuento por
 * hora UTC de la API (`hiddenByHour`, spec 2026-10-30).
 */
export function hiddenForDay(byHour: Readonly<Record<string, number>> | undefined, dayKey: string): number {
  let n = 0;
  for (const [hour, count] of Object.entries(byHour ?? {})) {
    if (madridDateKey(`${hour}:00:00Z`) === dayKey) n += count;
  }
  return n;
}
