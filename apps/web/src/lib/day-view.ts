/**
 * day-view.ts — qué se pinta en la home para un día y en qué orden.
 *
 * Referencia FotMob (spec 2026-10-16): la home es la jornada del día elegido,
 * agrupada en una tarjeta por competición. Arriba, los partidos de los equipos
 * que sigue el usuario ("Siguiendo"), que NO se repiten en su competición.
 * Bloques: competiciones seguidas primero, después por importancia (la misma
 * tabla que /competiciones) y, a igualdad, por nombre. Partidos por hora. Los
 * directos se quedan en su sitio: que empiece un partido no reordena nada.
 *
 * Función pura, sin React: testeable sin navegador. El día de cada partido se
 * calcula con `madridDateKey`, la autoridad horaria única de la app.
 */
import { APP_TZ } from '@/lib/match-time';
import { dateKeyIn } from '@/lib/viewer-tz-core';
import { importanceRank } from '@/lib/competition-importance';

export type DayFilter = 'all' | 'live' | 'following';

/**
 * Firma estructural mínima: los `Match` de la API la cumplen tal cual y los
 * tests no tienen que construir partidos completos.
 */
export interface DayViewMatch {
  id: string;
  status: string;
  scheduledAt: string | null;
  startedAt?: string | null;
  homeTeamId: string;
  awayTeamId: string;
  competitionId?: string | null;
  competitionName?: string | null;
  competitionSlug?: string | null;
  competitionCountry?: string | null;
  competitionLogoUrl?: string | null;
  competitionTier?: number | null;
  competitionFeaturedRank?: number | null;
}

export interface CompetitionBlock<T> {
  /** Clave estable del bloque (id de competición o, en su defecto, nombre). */
  key: string;
  id: string | null;
  /** `null` → el llamante pone su etiqueta i18n ("Otras competiciones"). */
  name: string | null;
  slug: string | null;
  /** ISO 3166-1 alpha-2, `'W'` para competiciones mundiales, o null. */
  country: string | null;
  /** Logo de la competición (migración 078); si falta, se usa la bandera. */
  logoUrl: string | null;
  /** Importancia en datos (migración 089); ordenan los bloques. */
  tier: number | null;
  featuredRank: number | null;
  /** El usuario sigue esta competición. */
  followed: boolean;
  matches: T[];
}

export interface DayView<T> {
  dayKey: string;
  /** Partidos del día (sin filtrar). */
  total: number;
  /** Partidos en juego del día (sin filtrar): alimenta el chip "En directo". */
  liveCount: number;
  /** Partidos del día de equipos o ligas seguidos (sin filtrar). */
  followingCount: number;
  /** Filtro aplicado de verdad: si el pedido no tiene partidos, cae a 'all'. */
  filter: DayFilter;
  /** Partidos (ya filtrados) de los equipos seguidos, por hora. */
  myTeams: T[];
  /** Resto de partidos (ya filtrados) en bloques por competición, ordenados. */
  competitions: CompetitionBlock<T>[];
}

export interface DayViewOptions {
  dayKey: string;
  teamIds?: readonly string[];
  leagueIds?: readonly string[];
  filter?: DayFilter;
  locale?: string;
  /** Zona horaria con la que se agrupan los días (la de quien mira). Por defecto, Madrid. */
  tz?: string;
  /** País preferido (ISO-2): sus competiciones van primero, luego las mundiales. Ordena, no excluye. */
  country?: string | null;
}

/** Instante del partido (o 0 si falta / es inválido) para ordenar establemente. */
function timeOf(m: DayViewMatch): number {
  const t = Date.parse(m.scheduledAt ?? m.startedAt ?? '');
  return Number.isFinite(t) ? t : 0;
}

function byTime(a: DayViewMatch, b: DayViewMatch): number {
  const d = timeOf(a) - timeOf(b);
  return d !== 0 ? d : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** 0 = el país preferido, 1 = mundial/sin país, 2 = otro país. */
function countryRank(blockCountry: string | null, preferred: string): number {
  if (blockCountry === preferred) return 0;
  if (!blockCountry || blockCountry === 'W') return 1;
  return 2;
}

/** La jornada de un día: filtrada, agrupada y ordenada. */
export function buildDayView<T extends DayViewMatch>(matches: T[], opts: DayViewOptions): DayView<T> {
  const teams = new Set(opts.teamIds ?? []);
  const leagues = new Set(opts.leagueIds ?? []);
  const locale = opts.locale ?? 'es';
  const country = opts.country ?? null;

  const isMyTeam = (m: T) => teams.has(m.homeTeamId) || teams.has(m.awayTeamId);
  const isFollowedLeague = (m: T) => !!m.competitionId && leagues.has(m.competitionId);
  const isFollowing = (m: T) => isMyTeam(m) || isFollowedLeague(m);
  const isLive = (m: T) => m.status === 'live';

  const tz = opts.tz ?? APP_TZ;
  const day = matches.filter((m) => dateKeyIn(m.scheduledAt, tz) === opts.dayKey);
  const liveCount = day.filter(isLive).length;
  const followingCount = day.filter(isFollowing).length;

  // Un filtro que se queda sin partidos (acabó el último directo, dejó de
  // seguir al equipo…) no debe dejar la pantalla en blanco: vuelve a 'all'.
  let filter: DayFilter = opts.filter ?? 'all';
  if ((filter === 'live' && liveCount === 0) || (filter === 'following' && followingCount === 0)) {
    filter = 'all';
  }
  const visible = filter === 'live' ? day.filter(isLive)
    : filter === 'following' ? day.filter(isFollowing)
    : day;

  const myTeams: T[] = [];
  const blocks = new Map<string, CompetitionBlock<T>>();
  for (const m of visible) {
    if (isMyTeam(m)) {
      myTeams.push(m);
      continue;
    }
    const key = m.competitionId || m.competitionName || '';
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
    if (country) {
      const c = countryRank(a.country, country) - countryRank(b.country, country);
      if (c !== 0) return c;
    }
    // Sin competición conocida: siempre al final.
    if ((a.name === null) !== (b.name === null)) return a.name === null ? 1 : -1;
    const d = importanceRank(a) - importanceRank(b);
    return d !== 0 ? d : (a.name ?? '').localeCompare(b.name ?? '', locale);
  });

  return { dayKey: opts.dayKey, total: day.length, liveCount, followingCount, filter, myTeams, competitions };
}

/**
 * Próxima jornada: el primer día POSTERIOR a `afterKey` con partidos, con la
 * misma agrupación que un día normal y sin filtro. `null` si no hay ninguno en
 * los partidos cargados.
 */
export function nextMatchday<T extends DayViewMatch>(
  matches: T[],
  afterKey: string,
  opts: Omit<DayViewOptions, 'dayKey' | 'filter'> = {},
): DayView<T> | null {
  let next: string | null = null;
  for (const m of matches) {
    const k = dateKeyIn(m.scheduledAt, opts.tz ?? APP_TZ);
    if (k && k > afterKey && (next === null || k < next)) next = k;
  }
  return next === null ? null : buildDayView(matches, { ...opts, dayKey: next, filter: 'all' });
}

/** Días (clave de Madrid) que tienen al menos un partido: puntos del selector. */
export function daysWithMatches(matches: readonly DayViewMatch[], tz: string = APP_TZ): Set<string> {
  const out = new Set<string>();
  for (const m of matches) {
    const k = dateKeyIn(m.scheduledAt, tz);
    if (k) out.add(k);
  }
  return out;
}

/** Máxima categoría: tier 1-2 (migración 089). */
const OPEN_MAX_TIER = 2;

/**
 * Bloques que la home abre por defecto (plan 2026-10-25, iteración 3):
 * seguidas, con algún partido en directo, destacadas (`featured_rank`) o de
 * máxima categoría. El resto (base, ligas menores) se queda plegado con su
 * recuento. Si ninguno califica, se abre el primero para no dejar todo cerrado.
 */
export function defaultOpenKeys(blocks: readonly {
  key: string;
  country?: string | null;
  followed: boolean;
  tier: number | null;
  featuredRank: number | null;
  matches: readonly { status: string }[];
}[], country: string | null = null): Set<string> {
  const open = new Set<string>();
  for (const b of blocks) {
    // Con país preferido, la importancia solo abre lo del país y lo mundial:
    // lo de otros países se queda plegado salvo que lo sigas o tenga directo.
    const relevantCountry = !country || countryRank(b.country ?? null, country) < 2;
    if (b.followed
      || b.matches.some((m) => m.status === 'live')
      || (relevantCountry && (b.featuredRank != null || (b.tier != null && b.tier <= OPEN_MAX_TIER)))) {
      open.add(b.key);
    }
  }
  if (open.size === 0 && blocks.length > 0) open.add(blocks[0]!.key);
  return open;
}
