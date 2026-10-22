import type { KnockoutStage, SeasonOverviewMatch } from './api/types';
import { dayDiff } from './day-view';

export type RoundSelection =
  | { kind: 'journey'; n: number }
  | { kind: 'round'; id: string };

export type FixturesFilterMode = 'round' | 'date' | 'team';

export interface RoundItem {
  id: string;
  number: number;
  name: string | null;
  roundType: string;
  phaseId?: string | null;
  stage?: string | null;
}

const STAGE_ORDER: Record<KnockoutStage, number> = {
  round_of_16: 0,
  quarters: 1,
  semis: 2,
  third_place: 3,
  final: 4,
  placement: 5,
};

const KNOCKOUT_STAGES = new Set<KnockoutStage>([
  'round_of_16',
  'quarters',
  'semis',
  'final',
  'third_place',
  'placement',
]);

export function isKnockoutStage(s: string | null | undefined): s is KnockoutStage {
  return !!s && KNOCKOUT_STAGES.has(s as KnockoutStage);
}

/** Ronda eliminatoria con fase explícita de la fuente. */
export function isKnockoutRound(r: Pick<RoundItem, 'roundType' | 'stage'>): boolean {
  return r.roundType === 'playoff' && isKnockoutStage(r.stage);
}

const APP_TZ = 'Europe/Madrid';

/** YYYY-MM-DD en la TZ de la competición (default Madrid): clave de día estable. */
export function madridDay(iso: string | null, tz?: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz || APP_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/** Primer día (Madrid / TZ de la competición) con partidos de cada ronda. */
function firstDayByRound(matches: SeasonOverviewMatch[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of matches) {
    if (!m.roundId) continue;
    const day = madridDay(m.scheduledAt, m.competitionTimezone);
    if (!day) continue;
    const prev = out.get(m.roundId);
    if (!prev || day < prev) out.set(m.roundId, day);
  }
  return out;
}

/**
 * Rondas del selector, en orden: jornadas por número, luego copa/amistoso con
 * partidos y por último las eliminatorias, por la fecha de su primer partido
 * y, sin fecha (cruces aún por determinar), por fase.
 */
export function selectableRounds(rounds: RoundItem[], matches: SeasonOverviewMatch[]): RoundItem[] {
  const hasMatches = (r: RoundItem) => matches.some((m) => m.roundId === r.id);
  const regular = rounds.filter((r) => r.roundType === 'regular').sort((a, b) => a.number - b.number);
  const other = rounds
    .filter((r) => r.roundType !== 'regular' && r.roundType !== 'playoff' && hasMatches(r))
    .sort((a, b) => a.number - b.number);

  const firstDay = firstDayByRound(matches);
  const stageRank = (r: RoundItem) => (r.stage && isKnockoutStage(r.stage) ? STAGE_ORDER[r.stage] ?? 9 : 9);
  const knockout = rounds.filter(isKnockoutRound).sort((a, b) => {
    const da = firstDay.get(a.id) ?? null;
    const db = firstDay.get(b.id) ?? null;
    if (da && db && da !== db) return da < db ? -1 : 1;
    if (!!da !== !!db) return da ? -1 : 1;
    return stageRank(a) - stageRank(b) || a.number - b.number;
  });

  return [...regular, ...other, ...knockout];
}

export function roundSelection(r: RoundItem): RoundSelection {
  return isKnockoutRound(r) ? { kind: 'round', id: r.id } : { kind: 'journey', n: r.number };
}

/** Clave estable para comparar selecciones de ronda. */
export function roundSelectionKey(sel: RoundSelection): string {
  return sel.kind === 'round' ? `r:${sel.id}` : `j:${sel.n}`;
}

export function parseRoundSelection(
  journeyParam: string | number | null | undefined,
  roundParam: string | null | undefined,
  selectable: RoundItem[],
): RoundSelection | null {
  if (roundParam && selectable.some((r) => isKnockoutRound(r) && r.id === roundParam)) {
    return { kind: 'round', id: roundParam };
  }
  if (journeyParam != null) {
    const num = typeof journeyParam === 'number' ? journeyParam : Number(journeyParam);
    if (!Number.isNaN(num) && num > 0) {
      return { kind: 'journey', n: num };
    }
  }
  return null;
}

/** Partidos correspondientes a una selección de ronda. */
export function matchesOfSelection(
  matches: SeasonOverviewMatch[],
  sel: RoundSelection,
): SeasonOverviewMatch[] {
  if (sel.kind === 'round') return matches.filter((m) => m.roundId === sel.id);
  return matches.filter((m) => m.roundType !== 'playoff' && (m.roundNumber ?? null) === sel.n);
}

/** Selección a la que pertenece un partido, si su ronda está en el selector. */
function selectionOfMatch(
  m: SeasonOverviewMatch,
  selectable: RoundItem[],
): { sel: RoundSelection; idx: number } | null {
  const idx =
    m.roundType === 'playoff'
      ? selectable.findIndex((r) => isKnockoutRound(r) && r.id === m.roundId)
      : selectable.findIndex((r) => !isKnockoutRound(r) && r.number === m.roundNumber);
  return idx < 0 ? null : { sel: roundSelection(selectable[idx]!), idx };
}

/**
 * Ronda que abre por defecto: la del partido más cercano a hoy.
 * A igualdad de distancia gana el futuro; tras ello la que tiene partidos
 * por jugar, y por último la que va antes en el selector.
 */
export function defaultRoundSelection(
  selectable: RoundItem[],
  matches: SeasonOverviewMatch[],
  todayKey: string,
): RoundSelection | null {
  let best: { sel: RoundSelection; rank: number; done: boolean; idx: number } | null = null;
  for (const m of matches) {
    const day = madridDay(m.scheduledAt, m.competitionTimezone);
    if (!day) continue;
    const own = selectionOfMatch(m, selectable);
    if (!own) continue;
    const diff = dayDiff(day, todayKey);
    const rank = Math.abs(diff) * 2 + (diff < 0 ? 1 : 0);
    const done = m.status === 'finished';
    const better =
      !best ||
      rank < best.rank ||
      (rank === best.rank && best.done && !done) ||
      (rank === best.rank && best.done === done && own.idx < best.idx);
    if (better) best = { sel: own.sel, rank, done, idx: own.idx };
  }
  if (best) return best.sel;
  for (const m of matches) {
    const own = selectionOfMatch(m, selectable);
    if (own) return own.sel;
  }
  return selectable[0] ? roundSelection(selectable[0]) : null;
}

export function stageLabel(stage: KnockoutStage, t: (k: string) => string): string | null {
  switch (stage) {
    case 'round_of_16':
      return t('playoffs.stage_round_of_16');
    case 'quarters':
      return t('playoffs.stage_quarters');
    case 'semis':
      return t('playoffs.stage_semis');
    case 'final':
      return t('playoffs.stage_final');
    case 'third_place':
      return t('playoffs.third_place');
    default:
      return null;
  }
}

export function roundLabel(r: RoundItem, t: (k: string) => string): string {
  if (r.roundType === 'regular') {
    const template = t('fixtures.matchday') || 'Jornada {n}';
    return template.replace('{n}', String(r.number));
  }
  if (r.stage && isKnockoutStage(r.stage)) {
    return stageLabel(r.stage, t) ?? r.name ?? t('playoffs.other_places');
  }
  return r.name ? `Playoffs · ${r.name}` : `Playoffs ${r.number}`;
}

/** Formatea una fecha YYYY-MM-DD para la píldora horizontal (ej. "ds. 21 oct"). */
export function dayPillLabel(d: string, locale: string = 'es'): string {
  const s = new Date(`${d}T12:00:00Z`).toLocaleDateString(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Fecha contigua dentro de la tira de días (-1 anterior, +1 siguiente). */
export function dateNeighbor(dates: string[], value: string | null, dir: -1 | 1): string | null {
  const i = value ? dates.indexOf(value) : -1;
  if (i === -1) return null;
  return dates[i + dir] ?? null;
}

export interface NearestDay {
  day: string;
  journey: number | null;
}

function isJornadaMatch(m: SeasonOverviewMatch): boolean {
  return m.roundType !== 'playoff';
}

export function nearestMatchDay(matches: SeasonOverviewMatch[], todayKey: string): NearestDay | null {
  let best: { day: string; m: SeasonOverviewMatch } | null = null;
  let bestRank = Infinity;
  let bestJornada: SeasonOverviewMatch | null = null;
  let bestJornadaRank = Infinity;

  for (const m of matches) {
    const day = madridDay(m.scheduledAt, m.competitionTimezone);
    if (!day) continue;
    const diff = dayDiff(day, todayKey);
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
