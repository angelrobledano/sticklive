'use client';

import { useViewerTz } from '@/hooks/useViewerTz';
import { useMemo, useCallback, useEffect, useRef, Fragment } from 'react';
import { LocaleLink as Link } from '@/components/shared/LocaleLink';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useT } from '@/lib/i18n';
import { track } from '@/lib/analytics';
import type { SeasonMatch, SeasonRound, TeamSummary } from '@/lib/api/client';
import { TeamShield } from '@/components/shared/TeamShield';
import { AdBanner } from '@/components/shared/AdBanner';
import { adsenseConfig, listAdInsertIndex } from '@/lib/ads';
import { clubName } from '@/lib/names';
import { tt } from '@/components/search/translate';
import { fmtTime, madridDay, dayPillLabel, roundLabel } from './format';
import { dayDiff, madridTodayKey } from '@/lib/match-time';
import {
  selectableRounds, roundSelection, roundSelectionKey, parseRoundSelection,
  matchesOfSelection, defaultRoundSelection, type RoundSelection,
} from './round-selection';

/** Config AdSense (env inyectado en build). */
const ADS = adsenseConfig();

/** Sentinela interna para partidos sin fecha (no se traduce en el agrupado). */
const NO_DATE = '__nodate__';

/**
 * Fecha contigua dentro de la tira de días (-1 anterior, +1 siguiente).
 * `null` en los extremos o si el valor activo no está en la lista.
 */
export function dateNeighbor(dates: string[], value: string | null, dir: -1 | 1): string | null {
  const i = value ? dates.indexOf(value) : -1;
  if (i === -1) return null;
  return dates[i + dir] ?? null;
}

/** Cronológico ascendente con los partidos SIN FECHA al final del calendario. */
function byScheduledAt(a: SeasonMatch, b: SeasonMatch): number {
  if (!a.scheduledAt) return b.scheduledAt ? 1 : 0;
  if (!b.scheduledAt) return -1;
  return a.scheduledAt.localeCompare(b.scheduledAt);
}

// ─── Filtro por defecto y modo (#157, #352) ─────────────────────────────────

/**
 * Día con más cercanía a hoy y la jornada de ese día (o `null` si no hay pistas).
 * Función pura: la usan el filtro por defecto y el conmutador de modo al saltar a
 * "Fecha" sin una fecha elegida todavía.
 */
export interface NearestDay {
  day: string;
  journey: number | null;
}

/**
 * Un partido de eliminatoria no está en ninguna JORNADA: su roundNumber legado
 * (1=cuartos, 2=semis…) chocaría con las jornadas 1, 2… de la liga. Las
 * eliminatorias se ven en la pestaña Playoffs (y aquí, por fecha o equipo).
 */
function isJornadaMatch(m: SeasonMatch): boolean {
  return m.roundType !== 'playoff';
}

export function nearestMatchDay(matches: SeasonMatch[], todayKey: string): NearestDay | null {
  let best: { day: string; m: SeasonMatch } | null = null;
  let bestRank = Infinity;
  // Durante un playoff el día más cercano es de eliminatoria: la jornada a
  // proponer es la del partido de liga más cercano (la última jugada).
  let bestJornada: SeasonMatch | null = null;
  let bestJornadaRank = Infinity;
  for (const m of matches) {
    const day = madridDay(m.scheduledAt, m.competitionTimezone);
    if (!day) continue;
    const diff = dayDiff(day, todayKey);
    // Distancia absoluta; en empate, el futuro (diff ≥ 0) va antes (rank menor).
    const rank = Math.abs(diff) * 2 + (diff < 0 ? 1 : 0);
    if (rank < bestRank) {
      bestRank = rank;
      best = { day, m };
    }
    if (isJornadaMatch(m) && rank < bestJornadaRank) {
      bestJornadaRank = rank;
      bestJornada = m;
    }
  }
  if (!best) return null;
  const journey = isJornadaMatch(best.m) ? best.m.roundNumber : (bestJornada?.roundNumber ?? null);
  return { day: best.day, journey };
}

/**
 * #157: filtro inicial de la pestaña Jornadas. Elegimos el DÍA MÁS CERCANO con
 * partidos (mismo patrón que la home): si el partido elegido tiene jornada,
 * activamos esa jornada; si no, esa fecha. A igual distancia gana el futuro.
 * Función pura, testeable sin navegador.
 */
export type DefaultFilter =
  | { journey: number; date: null }
  | { journey: null; date: string };

export function pickDefaultFilter(
  rounds: SeasonRound[],
  matches: SeasonMatch[],
  todayKey: string,
): DefaultFilter {
  const near = nearestMatchDay(matches, todayKey);
  if (near) {
    return near.journey != null
      ? { journey: near.journey, date: null }
      : { journey: null, date: near.day };
  }
  // Sin fechas: primera jornada CON partidos; si no la hay, la primera ronda.
  const withMatches = rounds.find((r) => matches.some((m) => m.roundNumber === r.number));
  return { journey: withMatches?.number ?? rounds[0]?.number ?? 1, date: null };
}

/**
 * #352: dimensión de filtrado de la pestaña Jornadas. Antes los tres filtros
 * (jornada, fecha, equipo) se apilaban y competían; ahora un conmutador revela
 * sólo el control del modo activo.
 */
export type FixturesFilterMode = 'date' | 'round' | 'team';

/**
 * Resuelve el modo a partir de la URL. El parámetro explícito `?filter=` manda;
 * si no viene, se infiere del valor presente (enlaces antiguos `?date=`/`?journey=`
 * /`?team_id=` sin `filter`); si no hay nada, `fallback`. Función pura.
 */
export function fixturesFilterMode(
  filterParam: string | null | undefined,
  values: { journey: number | null; date: string | null; team: string | null; round?: string | null },
  fallback: FixturesFilterMode,
): FixturesFilterMode {
  if (filterParam === 'date' || filterParam === 'round' || filterParam === 'team') return filterParam;
  if (values.team) return 'team';
  if (values.date) return 'date';
  if (values.journey != null || values.round) return 'round';
  return fallback;
}

// ─── Piezas de la lista ─────────────────────────────────────────────────────

function MatchCard({ match }: { match: SeasonMatch }) {
  const { t, locale } = useT();
  const viewerTz = useViewerTz();
  const isLive     = match.status === 'live';
  const isFinished = match.status === 'finished';
  const showScore  = isLive || isFinished;
  const ht = match.homeTeam;
  const at = match.awayTeam;

  return (
    <Link
      href={`/matches/${match.id}`}
      className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors"
    >
      {/* Local */}
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <TeamShield teamId={ht.id} teamName={ht.shortName ?? ht.name} size={24} />
        <span className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate">
          {ht.shortName ?? ht.name}
        </span>
      </div>

      {/* Marcador / hora */}
      <div className="shrink-0 flex flex-col items-center gap-0.5 min-w-[52px]">
        {showScore ? (
          <>
            <span className="font-score text-base font-bold tabular-nums text-slate-900 dark:text-slate-50">
              {match.score.home ?? 0} – {match.score.away ?? 0}
            </span>
            {isLive && (
              <span className="flex items-center gap-1 text-[10px] font-bold text-live uppercase tracking-wide">
                <span className="w-1.5 h-1.5 rounded-full bg-live animate-pulse" aria-hidden="true" />
                {t('match_states.live')}
              </span>
            )}
            {isFinished && (
              <span className="text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-wide">{t('match_states.final')}</span>
            )}
          </>
        ) : (
          <span className="font-score text-sm font-semibold text-slate-500 dark:text-slate-400 tabular-nums">
            {fmtTime(match.scheduledAt, viewerTz, locale)}
          </span>
        )}
        {/* Grupo de la fase de grupos (WSG): en una misma jornada se mezclan
            grupos, y sin la etiqueta no se distingue a qué grupo pertenece. */}
        {match.groupName && (
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            {t('standings.group')} {match.groupName}
          </span>
        )}
      </div>

      {/* Visitante */}
      <div className="flex items-center gap-2 flex-1 min-w-0 flex-row-reverse">
        <TeamShield teamId={at.id} teamName={at.shortName ?? at.name} size={24} />
        <span className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate text-right">
          {at.shortName ?? at.name}
        </span>
      </div>
    </Link>
  );
}

/** Estado vacío estilizado para cruces de filtros sin partidos. */
function EmptyFixtures() {
  const { t } = useT();
  return (
    <div className="card p-10 flex flex-col items-center text-center gap-3">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}
           className="w-9 h-9 text-slate-300 dark:text-slate-700">
        <rect x="3" y="4" width="18" height="17" rx="2" />
        <path d="M3 9h18M8 2v4M16 2v4" strokeLinecap="round" />
      </svg>
      <p className="text-sm text-slate-500 dark:text-slate-400">{t('fixtures.empty')}</p>
    </div>
  );
}

/** Lista de partidos agrupada por día (calendario completo de un equipo). */
function FixturesByDate({ matches }: { matches: SeasonMatch[] }) {
  const { t, locale } = useT();
  const groups = useMemo(() => {
    const map = new Map<string, SeasonMatch[]>();
    for (const m of matches) {
      const d = madridDay(m.scheduledAt, m.competitionTimezone) ?? NO_DATE;
      const arr = map.get(d);
      if (arr) arr.push(m); else map.set(d, [m]);
    }
    return [...map.entries()];
  }, [matches]);

  return (
    <div className="space-y-3">
      {groups.map(([d, ms]) => (
        <div key={d} className="card overflow-hidden">
          <div className="px-4 py-2 bg-slate-50 dark:bg-slate-800/40 border-b border-slate-100 dark:border-slate-800">
            <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">
              {d === NO_DATE ? tt(t, 'team.no_date', 'Sin fecha') : dayPillLabel(d, locale)}
            </span>
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-800/60">
            {ms.map((m) => <MatchCard key={m.id} match={m} />)}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Toolbar de filtros por modo ────────────────────────────────────────────

const MODE_LABEL: Record<FixturesFilterMode, { key: string; fallback: string }> = {
  date:  { key: 'fixtures.filter_date',  fallback: 'Fecha' },
  round: { key: 'fixtures.filter_round', fallback: 'Jornada' },
  team:  { key: 'fixtures.filter_team',  fallback: 'Equipo' },
};

function ModeIcon({ mode }: { mode: FixturesFilterMode }) {
  const common = {
    viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2,
    strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
    className: 'w-3.5 h-3.5', 'aria-hidden': true,
  };
  if (mode === 'date') {
    return (
      <svg {...common}>
        <rect x="3" y="4.5" width="18" height="16" rx="2.5" />
        <path d="M3 9.5h18M8 2.5v4M16 2.5v4" />
      </svg>
    );
  }
  if (mode === 'round') {
    return (
      <svg {...common}>
        <path d="M8.5 6H21M8.5 12H21M8.5 18H21" />
        <path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M12 3l7 3v5.5c0 4.2-2.9 7.4-7 8.5-4.1-1.1-7-4.3-7-8.5V6z" />
    </svg>
  );
}

function FilterModeTabs({ mode, modes, onChange }: {
  mode: FixturesFilterMode;
  modes: FixturesFilterMode[];
  onChange: (m: FixturesFilterMode) => void;
}) {
  const { t } = useT();
  return (
    <div
      role="group"
      aria-label={tt(t, 'fixtures.filter_by', 'Filtrar por')}
      className="inline-flex w-full gap-1 p-1 rounded-2xl bg-slate-100 dark:bg-slate-800/80"
    >
      {modes.map((m) => {
        const active = m === mode;
        return (
          <button
            key={m}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(m)}
            className={`flex-1 inline-flex items-center justify-center gap-1.5 min-h-[44px] px-2 rounded-xl text-xs transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-rink-passion dark:focus-visible:ring-rink-accent ${
              active
                ? 'bg-white dark:bg-slate-700 text-rink-passion dark:text-rink-accent font-semibold shadow-sm'
                : 'text-slate-500 dark:text-slate-400 font-medium hover:text-slate-700 dark:hover:text-slate-200'
            }`}
          >
            <ModeIcon mode={m} />
            {tt(t, MODE_LABEL[m].key, MODE_LABEL[m].fallback)}
          </button>
        );
      })}
    </div>
  );
}

function StepArrow({ dir, ...rest }: { dir: 'prev' | 'next' } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...rest}
      className="shrink-0 inline-flex items-center justify-center w-11 h-11 rounded-xl border border-slate-200 dark:border-slate-700
                 text-slate-500 dark:text-slate-400 disabled:opacity-40 disabled:cursor-not-allowed
                 hover:bg-slate-50 dark:hover:bg-slate-800/60 focus:outline-none focus:ring-2 focus:ring-rink-passion dark:focus:ring-rink-accent"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} className="w-4 h-4">
        <path d={dir === 'prev' ? 'M15 6l-6 6 6 6' : 'M9 6l6 6-6 6'} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

function RoundPicker({ rounds, value, onChange, onPrev, onNext }: {
  rounds: SeasonRound[];
  /** Clave de la selección activa (`roundSelectionKey`). */
  value: string | null;
  onChange: (r: SeasonRound) => void;
  onPrev?: () => void;
  onNext?: () => void;
}) {
  const { t } = useT();
  return (
    <div className="flex items-center gap-2">
      <StepArrow dir="prev" onClick={onPrev} disabled={!onPrev}
                 aria-label={tt(t, 'fixtures.prev_round', 'Jornada anterior')} />
      <div className="relative flex-1 min-w-0">
        <select
          value={value ?? ''}
          onChange={(e) => {
            const r = rounds.find((x) => roundSelectionKey(roundSelection(x)) === e.target.value);
            if (r) onChange(r);
          }}
          aria-label={tt(t, 'fixtures.by_round', 'Filtrar por jornada')}
          className="w-full min-h-[44px] pl-3 pr-8 rounded-xl border border-slate-200 dark:border-slate-700
                     bg-white dark:bg-slate-900 text-sm font-medium text-slate-700 dark:text-slate-200
                     focus:outline-none focus:ring-2 focus:ring-rink-passion dark:focus:ring-rink-accent cursor-pointer appearance-none"
        >
          {rounds.map((r) => (
            <option key={r.id} value={roundSelectionKey(roundSelection(r))}>{roundLabel(r, t)}</option>
          ))}
        </select>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}
             className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 dark:text-slate-400 pointer-events-none">
          <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <StepArrow dir="next" onClick={onNext} disabled={!onNext}
                 aria-label={tt(t, 'fixtures.next_round', 'Jornada siguiente')} />
    </div>
  );
}

function DatePills({ dates, value, onChange }: {
  dates: string[];
  value: string | null;
  onChange: (d: string) => void;
}) {
  const { t, locale } = useT();
  const prev = dateNeighbor(dates, value, -1);
  const next = dateNeighbor(dates, value, 1);
  const activeRef = useRef<HTMLButtonElement | null>(null);

  // Mantén visible el día activo: con una temporada entera la tira desborda y
  // el deep-link (?date=) podía caer fuera de la vista sin scrollbar en desktop.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [value]);

  return (
    <div className="flex items-center gap-2">
      <StepArrow
        dir="prev"
        onClick={prev ? () => onChange(prev) : undefined}
        disabled={!prev}
        aria-label={tt(t, 'fixtures.prev_date', 'Fecha anterior')}
      />
      <div className="flex flex-1 min-w-0 gap-2 overflow-x-auto scrollbar-none py-1">
        {dates.map((d) => {
          const active = d === value;
          return (
            <button
              key={d}
              ref={active ? activeRef : undefined}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(d)}
              className={`px-3 py-2 rounded-full text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
                active
                  ? 'bg-rink-passion text-white'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              {dayPillLabel(d, locale)}
            </button>
          );
        })}
      </div>
      <StepArrow
        dir="next"
        onClick={next ? () => onChange(next) : undefined}
        disabled={!next}
        aria-label={tt(t, 'fixtures.next_date', 'Fecha siguiente')}
      />
    </div>
  );
}

function TeamPicker({ teams, selectedId, onSelect }: {
  teams: TeamSummary[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  return (
    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
      {teams.map((tm) => {
        const active = tm.id === selectedId;
        return (
          <button
            key={tm.id}
            type="button"
            aria-pressed={active}
            onClick={() => onSelect(active ? null : tm.id)}
            className={`flex flex-col items-center gap-1 rounded-xl border px-1.5 py-2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-rink-passion dark:focus-visible:ring-rink-accent ${
              active
                ? 'border-rink-passion bg-rink-passion/5 dark:bg-rink-passion/10'
                : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-800/60'
            }`}
          >
            <TeamShield teamId={tm.id} teamName={tm.shortName ?? tm.name} size={30} />
            <span className={`w-full truncate text-center text-[11px] font-semibold ${
              active ? 'text-rink-passion dark:text-rink-accent' : 'text-slate-600 dark:text-slate-300'
            }`}>
              {clubName(tm.shortName ?? tm.name)}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function TeamHeader({ team, count }: { team: TeamSummary; count: number }) {
  const { t } = useT();
  return (
    <div className="card flex items-center gap-2.5 px-3 py-2.5">
      <TeamShield teamId={team.id} teamName={team.shortName ?? team.name} size={30} />
      <span className="min-w-0 truncate text-sm font-bold text-slate-800 dark:text-slate-100">
        {clubName(team.name)}
      </span>
      <span className="ml-auto shrink-0 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 tabular-nums">
        {count === 1
          ? tt(t, 'fixtures.match_count_one', '1 partido', { n: count })
          : tt(t, 'fixtures.match_count_many', '{n} partidos', { n: count })}
      </span>
    </div>
  );
}

// ─── Componente principal ───────────────────────────────────────────────────

export function GameweeksTab({ rounds, matches }: { rounds: SeasonRound[]; matches: SeasonMatch[] }) {
  const { t } = useT();
  const sp = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();

  const journeyParam = sp.get('journey');
  const dateParam = sp.get('date');
  const teamParam = sp.get('team_id');
  const filterParam = sp.get('filter');
  const roundParam = sp.get('round');

  // Rondas para el selector (spec 2026-10-16): jornadas por número, copa o
  // amistoso con partidos y, detrás, las ELIMINATORIAS con fase de la fuente
  // (cuartos, semis, 3.º y 4.º, final, colocación). Una eliminatoria se elige
  // por el id de su ronda (`?round=`): su número legado chocaba con las
  // jornadas. Las eliminatorias heredadas sin fase siguen fuera.
  const orderedRounds = useMemo(() => selectableRounds(rounds, matches), [rounds, matches]);

  // Equipos participantes (de los partidos), únicos y ordenados por nombre.
  const teams = useMemo(() => {
    const map = new Map<string, TeamSummary>();
    for (const m of matches) {
      if (m.homeTeam?.id) map.set(m.homeTeam.id, m.homeTeam);
      if (m.awayTeam?.id) map.set(m.awayTeam.id, m.awayTeam);
    }
    return [...map.values()].sort((a, b) => (a.shortName ?? a.name).localeCompare(b.shortName ?? b.name));
  }, [matches]);

  // Días con actividad (Madrid), únicos y ordenados.
  const dates = useMemo(() => {
    const set = new Set<string>();
    for (const m of matches) { const d = madridDay(m.scheduledAt, m.competitionTimezone); if (d) set.add(d); }
    return [...set].sort();
  }, [matches]);

  const todayKey = madridTodayKey();
  const fallback = useMemo(
    () => pickDefaultFilter(orderedRounds, matches, todayKey),
    [orderedRounds, matches, todayKey],
  );
  const nearest = useMemo(() => nearestMatchDay(matches, todayKey), [matches, todayKey]);

  // Modos disponibles según los datos: sin jornadas no hay "Jornada"; sin
  // equipos no hay "Equipo" (p. ej. una eliminatoria sin calendario).
  const availableModes = useMemo<FixturesFilterMode[]>(() => {
    const modes: FixturesFilterMode[] = [];
    if (dates.length > 0) modes.push('date');
    if (orderedRounds.length > 0) modes.push('round');
    if (teams.length > 0) modes.push('team');
    return modes.length > 0 ? modes : ['round'];
  }, [dates.length, orderedRounds.length, teams.length]);

  const parsedJourney = journeyParam != null && /^\d+$/.test(journeyParam)
    ? Number(journeyParam)
    : null;
  const selectedTeam = teamParam ? teams.find((tm) => tm.id === teamParam) ?? null : null;

  const requestedMode = fixturesFilterMode(
    filterParam,
    { journey: parsedJourney, date: dateParam, team: teamParam, round: roundParam },
    // Por defecto, Jornada (si está disponible): es la dimensión natural de la
    // pestaña. Si la temporada no tiene `rounds`, el guard de abajo cae al
    // primer modo disponible (p. ej. Fecha).
    'round',
  );
  const mode: FixturesFilterMode = availableModes.includes(requestedMode) ? requestedMode : availableModes[0]!;

  // Valor activo por modo: el de la URL o, si no, el más cercano a hoy para que
  // cambiar de modo siempre muestre contenido.
  const activeDate = mode === 'date' ? (dateParam ?? fallback.date ?? nearest?.day ?? null) : null;
  const requestedRound = useMemo(
    () => parseRoundSelection(journeyParam, roundParam, orderedRounds),
    [journeyParam, roundParam, orderedRounds],
  );
  const defaultRound = useMemo(
    () => defaultRoundSelection(orderedRounds, matches, todayKey),
    [orderedRounds, matches, todayKey],
  );
  const activeRound: RoundSelection | null = mode === 'round' ? (requestedRound ?? defaultRound) : null;
  const activeRoundKey = activeRound ? roundSelectionKey(activeRound) : null;
  const activeTeam = mode === 'team' ? selectedTeam : null;

  const navigate = useCallback((mutate: (p: URLSearchParams) => void) => {
    const params = new URLSearchParams(sp.toString());
    mutate(params);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [sp, pathname, router]);

  /** Cambiar de modo conserva sólo el valor del modo nuevo (con exclusión mutua). */
  const selectMode = useCallback((next: FixturesFilterMode) => {
    navigate((p) => {
      p.delete('journey'); p.delete('round'); p.delete('date'); p.delete('team_id');
      p.set('filter', next);
      if (next === 'round') {
        const sel = requestedRound ?? defaultRound;
        if (sel?.kind === 'journey') p.set('journey', String(sel.n));
        if (sel?.kind === 'round') p.set('round', sel.id);
      } else if (next === 'date') {
        const d = dateParam ?? fallback.date ?? nearest?.day;
        if (d) p.set('date', d);
      }
    });
    track('fixtures_filter_applied', { filter_type: next, value: '' });
  }, [navigate, requestedRound, defaultRound, fallback, nearest, dateParam]);

  const selectRound = useCallback((r: SeasonRound) => {
    const sel = roundSelection(r);
    navigate((p) => {
      p.delete('date'); p.delete('team_id'); p.delete('journey'); p.delete('round');
      p.set('filter', 'round');
      if (sel.kind === 'journey') p.set('journey', String(sel.n)); else p.set('round', sel.id);
    });
    track('fixtures_filter_applied', { filter_type: 'round', value: sel.kind === 'journey' ? String(sel.n) : (r.stage ?? r.id) });
  }, [navigate]);

  const selectDate = useCallback((d: string) => {
    navigate((p) => { p.delete('journey'); p.delete('round'); p.delete('team_id'); p.set('filter', 'date'); p.set('date', d); });
    track('fixtures_filter_applied', { filter_type: 'date', value: d });
  }, [navigate]);

  const selectTeam = useCallback((id: string | null) => {
    navigate((p) => {
      p.delete('journey'); p.delete('round'); p.delete('date'); p.set('filter', 'team');
      if (id) p.set('team_id', id); else p.delete('team_id');
    });
    track('fixtures_filter_applied', { filter_type: 'team', value: id ?? '' });
  }, [navigate]);

  const filtered = useMemo(() => {
    if (mode === 'team') {
      if (!activeTeam) return [];
      return matches
        .filter((m) => m.homeTeam?.id === activeTeam.id || m.awayTeam?.id === activeTeam.id)
        .sort(byScheduledAt);
    }
    if (mode === 'date' && activeDate) {
      return matches
        .filter((m) => madridDay(m.scheduledAt, m.competitionTimezone) === activeDate)
        .sort((a, b) => (a.scheduledAt ?? '').localeCompare(b.scheduledAt ?? ''));
    }
    if (mode === 'round' && activeRound) {
      return matchesOfSelection(matches, activeRound)
        .sort((a, b) => (a.scheduledAt ?? '').localeCompare(b.scheduledAt ?? ''));
    }
    return [];
  }, [matches, mode, activeTeam, activeDate, activeRound]);

  // Banner "entre resultados" en la lista plana (jornada/fecha). -1 si no procede.
  const adIndex = useMemo(
    () => listAdInsertIndex(filtered.length, ADS.listEvery),
    [filtered.length],
  );

  const roundIdx = activeRoundKey != null
    ? orderedRounds.findIndex((r) => roundSelectionKey(roundSelection(r)) === activeRoundKey)
    : -1;
  const prevRound = roundIdx > 0 ? orderedRounds[roundIdx - 1] : undefined;
  const nextRound = roundIdx >= 0 && roundIdx < orderedRounds.length - 1 ? orderedRounds[roundIdx + 1] : undefined;

  return (
    <div className="space-y-3">
      {/* ── Toolbar de filtros por modo ────────────────────────── */}
      <div className="space-y-2.5">
        <FilterModeTabs mode={mode} modes={availableModes} onChange={selectMode} />

        {mode === 'round' && orderedRounds.length > 0 && (
          <RoundPicker
            rounds={orderedRounds}
            value={activeRoundKey}
            onChange={selectRound}
            onPrev={prevRound ? () => selectRound(prevRound) : undefined}
            onNext={nextRound ? () => selectRound(nextRound) : undefined}
          />
        )}

        {mode === 'date' && dates.length > 0 && (
          <DatePills dates={dates} value={activeDate} onChange={selectDate} />
        )}

        {mode === 'team' && teams.length > 0 && (
          <TeamPicker teams={teams} selectedId={activeTeam?.id ?? null} onSelect={selectTeam} />
        )}
      </div>

      {/* ── Resultados ────────────────────────────────────── */}
      {mode === 'team' ? (
        !activeTeam ? (
          <p className="card p-6 text-center text-sm text-slate-500 dark:text-slate-400">
            {tt(t, 'fixtures.choose_team', 'Elige un equipo para ver todos sus partidos.')}
          </p>
        ) : (
          <div className="space-y-3">
            <TeamHeader team={activeTeam} count={filtered.length} />
            {filtered.length === 0 ? <EmptyFixtures /> : <FixturesByDate matches={filtered} />}
          </div>
        )
      ) : filtered.length === 0 ? (
        <EmptyFixtures />
      ) : (
        <div className="card overflow-hidden divide-y divide-slate-100 dark:divide-slate-800/60">
          {filtered.map((m, i) => (
            <Fragment key={m.id}>
              {i === adIndex && <AdBanner zone="list-inline" className="my-2" />}
              <MatchCard match={m} />
            </Fragment>
          ))}
        </div>
      )}
    </div>
  );
}
