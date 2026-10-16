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
import type { KnockoutStage, SeasonMatch, SeasonRound } from '@/lib/api/client';
import { isKnockoutStage } from '@/lib/stage-label';
import { dayDiff } from '@/lib/match-time';
import { madridDay } from './format';

export type RoundSelection =
  | { kind: 'journey'; n: number }
  | { kind: 'round'; id: string };

const STAGE_ORDER: Record<KnockoutStage, number> = {
  round_of_16: 0, quarters: 1, semis: 2, third_place: 3, final: 4, placement: 5,
};

/** Ronda eliminatoria con fase explícita de la fuente. */
export function isKnockoutRound(r: Pick<SeasonRound, 'roundType' | 'stage'>): boolean {
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
export function selectableRounds(rounds: SeasonRound[], matches: SeasonMatch[]): SeasonRound[] {
  const hasMatches = (r: SeasonRound) => matches.some((m) => m.roundId === r.id);
  const regular = rounds.filter((r) => r.roundType === 'regular').sort((a, b) => a.number - b.number);
  const other = rounds
    .filter((r) => r.roundType !== 'regular' && r.roundType !== 'playoff' && hasMatches(r))
    .sort((a, b) => a.number - b.number);

  const firstDay = firstDayByRound(matches);
  const stageRank = (r: SeasonRound) => STAGE_ORDER[r.stage as KnockoutStage] ?? 9;
  const knockout = rounds.filter(isKnockoutRound).sort((a, b) => {
    const da = firstDay.get(a.id) ?? null;
    const db = firstDay.get(b.id) ?? null;
    if (da && db && da !== db) return da < db ? -1 : 1;
    if (!!da !== !!db) return da ? -1 : 1;
    return stageRank(a) - stageRank(b) || a.number - b.number;
  });

  return [...regular, ...other, ...knockout];
}

export function roundSelection(r: SeasonRound): RoundSelection {
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
  journeyParam: string | null,
  roundParam: string | null,
  selectable: SeasonRound[],
): RoundSelection | null {
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
function selectionOfMatch(m: SeasonMatch, selectable: SeasonRound[]): { sel: RoundSelection; idx: number } | null {
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
  selectable: SeasonRound[],
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
