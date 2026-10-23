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
import { madridDateKey } from '@/lib/match-time';
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

/** La jornada de un día: filtrada, agrupada y ordenada. */
export function buildDayView<T extends DayViewMatch>(matches: T[], opts: DayViewOptions): DayView<T> {
  const teams = new Set(opts.teamIds ?? []);
  const leagues = new Set(opts.leagueIds ?? []);
  const locale = opts.locale ?? 'es';

  const isMyTeam = (m: T) => teams.has(m.homeTeamId) || teams.has(m.awayTeamId);
  const isFollowedLeague = (m: T) => !!m.competitionId && leagues.has(m.competitionId);
  const isFollowing = (m: T) => isMyTeam(m) || isFollowedLeague(m);
  const isLive = (m: T) => m.status === 'live';

  const day = matches.filter((m) => madridDateKey(m.scheduledAt) === opts.dayKey);
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
    const k = madridDateKey(m.scheduledAt);
    if (k && k > afterKey && (next === null || k < next)) next = k;
  }
  return next === null ? null : buildDayView(matches, { ...opts, dayKey: next, filter: 'all' });
}

/** Días (clave de Madrid) que tienen al menos un partido: puntos del selector. */
export function daysWithMatches(matches: readonly DayViewMatch[]): Set<string> {
  const out = new Set<string>();
  for (const m of matches) {
    const k = madridDateKey(m.scheduledAt);
    if (k) out.add(k);
  }
  return out;
}
