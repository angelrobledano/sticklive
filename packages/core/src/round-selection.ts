/**
 * round-selection.ts — qué rondas ofrece la pestaña Jornadas y cómo se elige
 * una (spec 2026-10-16).
 *
 * Además de las jornadas, el selector incluye las rondas eliminatorias con
 * `stage` explícito de la fuente (cuartos, semis, 3.º y 4.º, final y
 * colocación). Una jornada se identifica por su número (`?journey=`, como
 * siempre); una eliminatoria por el id de su ronda (`?round=`): el número
 * legado de una eliminatoria (1=cuartos, 2=semis…) chocaba con las jornadas
 * 1, 2… Las rondas heredadas sin `stage` siguen fuera, como hasta ahora.
 *
 * Funciones puras, testeadas sin navegador.
 */
import type { KnockoutStage, SeasonMatch, SeasonRound } from './api';
import { isKnockoutStage, stageLabel } from './stage-label';
import { dayDiff } from './match-time';
import { madridDay } from './phase-keys';

export { isKnockoutStage, stageLabel, madridDay };

/** Filtro de la pestaña Jornadas en la app: por ronda, por fecha o por equipo. */
export type FixturesFilterMode = 'round' | 'date' | 'team';

/**
 * Forma mínima de una ronda del selector. `SeasonRound` la cumple; la app la
 * usa con rondas que traen `roundType`/`stage` como texto libre.
 */
export interface RoundItem {
  id: string;
  number: number;
  name: string | null;
  roundType: string;
  phaseId?: string | null;
  stage?: string | null;
}

export type RoundSelection =
  | { kind: 'journey'; n: number }
  | { kind: 'round'; id: string };

const STAGE_ORDER: Record<KnockoutStage, number> = {
  round_of_16: 0, quarters: 1, semis: 2, third_place: 3, final: 4, placement: 5,
};

/** Ronda eliminatoria con fase explícita de la fuente. */
export function isKnockoutRound(r: Pick<RoundItem, 'roundType' | 'stage'>): boolean {
  return r.roundType === 'playoff' && isKnockoutStage(r.stage);
}

/** Primer día (Madrid / TZ de la competición) con partidos de cada ronda. */
function firstDayByRound(matches: SeasonMatch[]): Map<string, string> {
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
 * partidos (como antes) y por último las eliminatorias, por la fecha de su
 * primer partido y, sin fecha (cruces aún por determinar), por fase.
 */
export function selectableRounds<R extends RoundItem = SeasonRound>(rounds: R[], matches: SeasonMatch[]): R[] {
  const hasMatches = (r: R) => matches.some((m) => m.roundId === r.id);
  const regular = rounds.filter((r) => r.roundType === 'regular').sort((a, b) => a.number - b.number);
  const other = rounds
    .filter((r) => r.roundType !== 'regular' && r.roundType !== 'playoff' && hasMatches(r))
    .sort((a, b) => a.number - b.number);

  const firstDay = firstDayByRound(matches);
  const stageRank = (r: R) => STAGE_ORDER[r.stage as KnockoutStage] ?? 9;
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

/** Clave estable para el `<select>` y para comparar selecciones. */
export function roundSelectionKey(sel: RoundSelection): string {
  return sel.kind === 'round' ? `r:${sel.id}` : `j:${sel.n}`;
}

/**
 * Selección que pide la URL, o `null` si no pide nada válido. `?round=` manda
 * sobre `?journey=`; un valor que no es una ronda del selector se ignora.
 */
export function parseRoundSelection(
  journeyParam: string | number | null | undefined,
  roundParam: string | null | undefined,
  selectable: RoundItem[],
): RoundSelection | null {
  if (typeof journeyParam === 'number') journeyParam = String(journeyParam);
  if (roundParam && selectable.some((r) => isKnockoutRound(r) && r.id === roundParam)) {
    return { kind: 'round', id: roundParam };
  }
  if (journeyParam != null && /^\d+$/.test(journeyParam)) return { kind: 'journey', n: Number(journeyParam) };
  return null;
}

/**
 * Partidos de una selección. Una jornada nunca incluye eliminatorias (su
 * `roundNumber` legado chocaría); una eliminatoria va por el id de su ronda.
 */
export function matchesOfSelection(matches: SeasonMatch[], sel: RoundSelection): SeasonMatch[] {
  if (sel.kind === 'round') return matches.filter((m) => m.roundId === sel.id);
  return matches.filter((m) => m.roundType !== 'playoff' && (m.roundNumber ?? null) === sel.n);
}

/** Selección a la que pertenece un partido, si su ronda está en el selector. */
function selectionOfMatch(m: SeasonMatch, selectable: RoundItem[]): { sel: RoundSelection; idx: number } | null {
  const idx = m.roundType === 'playoff'
    ? selectable.findIndex((r) => isKnockoutRound(r) && r.id === m.roundId)
    : selectable.findIndex((r) => !isKnockoutRound(r) && r.number === m.roundNumber);
  return idx < 0 ? null : { sel: roundSelection(selectable[idx]!), idx };
}

/**
 * Ronda que abre por defecto: la del partido más cercano a hoy (a igual
 * distancia, el futuro, después la que tiene partidos por jugar y, por último,
 * la que va antes en el selector). Durante la
 * fase final es la eliminatoria en curso. Sin fechas, la primera ronda con
 * partidos; sin nada, la primera ronda (o `null` si no hay).
 */
export function defaultRoundSelection(
  selectable: RoundItem[],
  matches: SeasonMatch[],
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
    // A igual día, manda la ronda con partidos por jugar: unos cuartos de
    // madrugada ya terminados no tapan la semifinal de esa misma noche.
    const done = m.status === 'finished';
    const better = !best
      || rank < best.rank
      || (rank === best.rank && best.done && !done)
      || (rank === best.rank && best.done === done && own.idx < best.idx);
    if (better) best = { sel: own.sel, rank, done, idx: own.idx };
  }
  if (best) return best.sel;
  for (const m of matches) {
    const own = selectionOfMatch(m, selectable);
    if (own) return own.sel;
  }
  return selectable[0] ? roundSelection(selectable[0]) : null;
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

function isJornadaMatch(m: SeasonMatch): boolean {
  return m.roundType !== 'playoff';
}

/** Día con partidos más cercano a hoy y la jornada más cercana (sin eliminatorias). */
export function nearestMatchDay(matches: SeasonMatch[], todayKey: string): NearestDay | null {
  let best: { day: string; m: SeasonMatch } | null = null;
  let bestRank = Infinity;
  let bestJornada: SeasonMatch | null = null;
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
