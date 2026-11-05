/**
 * Derivación de rondas de un cuadro eliminatorio a partir de sus partidos.
 *
 * La fuente da la fase con calidad variable (lecciones de los datos reales):
 *  - Copa del Rey / Copa de la Reina: TODOS los partidos en una única ronda
 *    llamada "FINAL" (rn=4) — la fase real (Cuartos → Semis → Final) hay que
 *    deducirla del propio cuadro.
 *  - Copa SAR: una ronda "FINAL" con 2 semis + final (4 equipos).
 *  - OK Liga eliminatoria: ida/vuelta sin fase (una sola eliminatoria).
 *
 * Estrategia, de más fiable a menos:
 *  1. Si la fuente nombra ≥2 fases reconocibles (Cuartos/Semis/Final…), se usa
 *     ese agrupamiento.
 *  2. Si no, se RECONSTRUYE el cuadro por el grafo de avance: cada eliminatoria
 *     enlaza con aquella posterior en la que juega su ganador; la final es la
 *     que no alimenta a ninguna. La profundidad desde la final da la ronda.
 *  3. Si nada es fiable, una única ronda con todo (sin inventar fases).
 *
 * Funciones puras y testeadas.
 */
import type { SeasonMatch, SeasonRound } from '@/lib/api/client';
import { gameWinnerId } from '@sports/core/playoff';
import { matchPhaseKey, playoffPhaseKey, type PlayoffPhaseKey } from '@sports/core/phase-keys';

export interface BracketRound {
  /** Fase canónica si se conoce; `null` = ronda no reconocida (usar `name`). */
  key: PlayoffPhaseKey | null;
  /** Nombre de la fuente (para rondas no reconocidas). */
  name: string | null;
  roundNumber: number | null;
  matches: SeasonMatch[];
}

/** Orden canónico de las fases (de primera a última). */
const PHASE_ORDER: Record<PlayoffPhaseKey, number> = {
  round_of_16: 0, quarters: 1, semis: 2, final: 3, third_place: 4,
};

/** Fase por distancia a la final (0 = la final). */
const FROM_FINAL: PlayoffPhaseKey[] = ['final', 'semis', 'quarters', 'round_of_16'];

function byDate(a: SeasonMatch, b: SeasonMatch): number {
  return (a.scheduledAt ?? '') < (b.scheduledAt ?? '') ? -1 : 1;
}

function pairKey(home: string, away: string): string {
  return home < away ? `${home}|${away}` : `${away}|${home}`;
}

function matchWinnerId(m: SeasonMatch): string | null {
  return m.status === 'finished' ? gameWinnerId(m) : null;
}

/** Ganador de una eliminatoria (suma ida+vuelta; en empate, el ganador explícito). */
function tieWinnerId(tie: { teamIds: string[]; legs: SeasonMatch[] }): string | null {
  const [a, b] = tie.teamIds as [string, string];
  let ga = 0;
  let gb = 0;
  let any = false;
  for (const leg of tie.legs) {
    if (leg.status !== 'finished' || leg.score.home == null || leg.score.away == null) continue;
    any = true;
    if (leg.homeTeam.id === a) { ga += leg.score.home; gb += leg.score.away; }
    else { gb += leg.score.home; ga += leg.score.away; }
  }
  if (any) {
    if (ga > gb) return a;
    if (gb > ga) return b;
  }
  for (let i = tie.legs.length - 1; i >= 0; i--) {
    const w = matchWinnerId(tie.legs[i]!);
    if (w) return w;
  }
  return null;
}

interface Tie {
  key: string;
  teamIds: string[];
  legs: SeasonMatch[];
}

/** Agrupa ida/vuelta en una sola eliminatoria (por pareja de equipos). */
function groupIntoTies(matches: SeasonMatch[]): Tie[] {
  const map = new Map<string, Tie>();
  for (const m of matches) {
    const k = pairKey(m.homeTeam.id, m.awayTeam.id);
    const t = map.get(k);
    if (t) t.legs.push(m);
    else map.set(k, { key: k, teamIds: [m.homeTeam.id, m.awayTeam.id].sort(), legs: [m] });
  }
  return [...map.values()];
}

function groupBySourceRound(pool: SeasonMatch[]): BracketRound[] {
  const groups = new Map<string, SeasonMatch[]>();
  for (const m of pool) {
    const key = m.roundId ?? m.roundName ?? `rn:${m.roundNumber ?? 'null'}`;
    const g = groups.get(key);
    if (g) g.push(m);
    else groups.set(key, [m]);
  }
  const rounds: BracketRound[] = [];
  for (const group of groups.values()) {
    const first = group[0]!;
    // La fase EXPLÍCITA de la fuente (`stage`) manda. Sin ella (datos
    // heredados) se lee del NOMBRE; el número solo como último recurso. Así una
    // ronda sin nombre de fase ("Jornada 9", "Jornada 10") no se confunde con
    // una fase por su numeración (playoffPhaseKey mapea rn>=3 a 'final').
    const key = first.stage
      ? matchPhaseKey(first)
      : first.roundName
        ? playoffPhaseKey(first.roundName, null)
        : playoffPhaseKey(null, first.roundNumber);
    rounds.push({ key, name: first.roundName, roundNumber: first.roundNumber, matches: group.sort(byDate) });
  }
  return rounds;
}

/** Reconstruye las rondas por el grafo de avance. Devuelve [] si no es fiable. */
function deriveByAdvancement(pool: SeasonMatch[]): BracketRound[] {
  const ties = groupIntoTies(pool);
  if (ties.length < 2) return [];

  const isThird = (t: Tie) =>
    t.legs.some((l) => matchPhaseKey(l) === 'third_place');
  const main = ties.filter((t) => !isThird(t));
  const thirds = ties.filter(isThird);
  if (main.length < 2) return [];

  const winner = new Map(main.map((t) => [t.key, tieWinnerId(t)]));
  // Fecha de la última manga de cada eliminatoria: el avance va SIEMPRE hacia
  // una eliminatoria posterior (si no, el campeón "alimentaría" sus propias
  // rondas anteriores).
  const lastDate = new Map(main.map((t) => [
    t.key,
    t.legs.reduce((acc, l) => ((l.scheduledAt ?? '') > acc ? (l.scheduledAt ?? '') : acc), ''),
  ]));
  const next = new Map<string, string[]>();
  for (const t of main) {
    const w = winner.get(t.key) ?? null;
    const d = lastDate.get(t.key) ?? '';
    next.set(
      t.key,
      w
        ? main
            .filter((u) => u.key !== t.key && u.teamIds.includes(w) && (lastDate.get(u.key) ?? '') > d)
            .map((u) => u.key)
        : [],
    );
  }

  // La final es la única eliminatoria que no alimenta a ninguna otra.
  const finals = main.filter((t) => (next.get(t.key) ?? []).length === 0);
  if (finals.length !== 1) return [];
  const finalKey = finals[0]!.key;

  // Profundidad = distancia a la final (final = 0).
  const rev = new Map<string, string[]>(main.map((t) => [t.key, []]));
  for (const t of main) for (const u of next.get(t.key)!) rev.get(u)!.push(t.key);
  const depth = new Map<string, number>([[finalKey, 0]]);
  const queue = [finalKey];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const feeder of rev.get(cur) ?? []) {
      const d = (depth.get(cur) ?? 0) + 1;
      if ((depth.get(feeder) ?? -1) < d) { depth.set(feeder, d); queue.push(feeder); }
    }
  }
  // Si alguna eliminatoria no cuelga de la final, el cuadro no es fiable.
  if (main.some((t) => !depth.has(t.key))) return [];

  const maxDepth = Math.max(...depth.values());
  const rounds: BracketRound[] = [];
  for (let d = maxDepth; d >= 0; d--) {
    const legs = main.filter((t) => depth.get(t.key) === d).flatMap((t) => t.legs).sort(byDate);
    if (legs.length > 0) rounds.push({ key: FROM_FINAL[d] ?? null, name: null, roundNumber: null, matches: legs });
  }
  if (thirds.length > 0) {
    rounds.push({ key: 'third_place', name: null, roundNumber: null, matches: thirds.flatMap((t) => t.legs).sort(byDate) });
  }
  return rounds;
}

/**
 * Rondas del cuadro, de la primera a la última (la final al final). Devuelve []
 * si no hay partidos.
 */
export function buildBracketRounds(matches: SeasonMatch[]): BracketRound[] {
  const playoff = matches.filter((m) => m.roundType === 'playoff');
  const pool = playoff.length > 0 ? playoff : matches;
  if (pool.length === 0) return [];

  const byName = groupBySourceRound(pool);
  const recognized = byName.filter((r) => r.key !== null);
  // Con la fase explícita de la fuente basta una ronda (p. ej. solo se han
  // jugado los cuartos): no hay nada que deducir del cuadro.
  const explicit = pool.every((m) => matchPhaseKey({ stage: m.stage }) !== null);
  if (explicit || recognized.length >= 2) {
    return [...byName].sort(
      (a, b) =>
        (a.key ? PHASE_ORDER[a.key] : 99) - (b.key ? PHASE_ORDER[b.key] : 99) ||
        (a.roundNumber ?? 0) - (b.roundNumber ?? 0),
    );
  }

  const derived = deriveByAdvancement(pool);
  if (derived.length >= 2) return derived;

  const first = pool[0]!;
  // Una sola ronda: conservamos el nombre de la fuente solo si TODOS los
  // partidos comparten ronda (si no, es un cajón de sastre, p. ej. ida/vuelta).
  const names = new Set(pool.map((m) => m.roundName ?? ''));
  const shared = names.size === 1 ? (first.roundName ?? null) : null;
  return [{ key: null, name: shared, roundNumber: shared ? first.roundNumber : null, matches: pool.slice().sort(byDate) }];
}

export interface BracketColumn extends BracketRound {
  /** Cruces que tiene la ronda en el cuadro (los que faltan son «por determinar»). */
  slots: number;
}

/**
 * Completa el cuadro con las rondas que la fuente DECLARA pero aún no tienen
 * partidos (o no todos): con solo los cuartos publicados, semis y final entran
 * como huecos «por determinar» y el cuadro se dibuja entero (4 → 2 → 1). Solo
 * rondas posteriores a la última con partidos y con fase reconocida.
 */
export function completeBracket(bracket: BracketRound[], declared: SeasonRound[]): BracketColumn[] {
  const main = bracket.filter((r) => r.key !== 'third_place' && r.matches.length > 0);
  const cols: BracketColumn[] = [];
  for (const r of main) {
    const prev = cols[cols.length - 1];
    const expected = prev && r.key ? Math.ceil(prev.slots / 2) : 0;
    cols.push({ ...r, slots: Math.max(r.matches.length, expected) });
  }
  const last = cols[cols.length - 1];
  if (!last?.key) return cols;
  const pendingStages = FROM_FINAL
    .filter((k) => PHASE_ORDER[k] > PHASE_ORDER[last.key!])
    .filter((k) => declared.some((d) => d.roundType === 'playoff' && d.stage === k))
    .sort((a, b) => PHASE_ORDER[a] - PHASE_ORDER[b]);
  for (const key of pendingStages) {
    const prev = cols[cols.length - 1]!;
    if (prev.slots <= 1) break;
    const round = declared.find((d) => d.stage === key)!;
    cols.push({ key, name: round.name, roundNumber: round.number, matches: [], slots: Math.ceil(prev.slots / 2) });
  }
  return alignBracket(cols);
}

/** Equipos que juegan un partido. */
const teamsOf = (m: SeasonMatch) => [m.homeTeam.id, m.awayTeam.id];

/**
 * Ordena cada ronda según la siguiente: los dos cruces que alimentan el cruce j
 * van en las posiciones 2j y 2j+1, para que el cuadro los dibuje unidos
 * (Elite Cup: semis BEN–SAD y SIM–POR salen de los cuartos 1+4 y 2+3, no de
 * 1+2 y 3+4 por fecha). Va de la final hacia atrás. Lo que no cuadra (cruce sin
 * decidir, datos sueltos) queda detrás en su orden original.
 */
export function alignBracket(cols: BracketColumn[]): BracketColumn[] {
  const out = cols.map((c) => ({ ...c, matches: [...c.matches] }));
  for (let i = out.length - 1; i > 0; i--) {
    const next = out[i]!.matches;
    const prev = out[i - 1]!;
    if (next.length === 0 || prev.matches.length === 0) continue;
    const pending = [...prev.matches];
    const ordered: (SeasonMatch | null)[] = [];
    for (const n of next) {
      const ts = teamsOf(n);
      for (const t of ts) {
        const k = pending.findIndex((m) => matchWinnerId(m) === t);
        ordered.push(k === -1 ? null : pending.splice(k, 1)[0]!);
      }
    }
    // Huecos sin decidir: se rellenan con lo que queda, en orden.
    const filled = ordered.map((m) => m ?? pending.shift() ?? null).filter((m): m is SeasonMatch => m !== null);
    prev.matches = [...filled, ...pending];
  }
  return out;
}

export type SlotFeeder =
  | { kind: 'team'; team: SeasonMatch['homeTeam'] }
  | { kind: 'match'; match: SeasonMatch }
  | { kind: 'slot'; round: BracketColumn; index: number };

/**
 * Procedencia de los dos equipos de un hueco del cuadro (columna `ri`, cruce
 * `j`): los cruces 2j y 2j+1 de la ronda anterior. Si ya se decidió, el
 * equipo que pasa; si no, el cruce («Ganador BEN / COL») o el hueco anterior
 * («Ganador Semifinal 1»).
 */
export function slotFeeders(cols: BracketColumn[], ri: number, j: number): SlotFeeder[] | null {
  const prev = cols[ri - 1];
  if (!prev) return null;
  return [2 * j, 2 * j + 1].map((k): SlotFeeder => {
    const m = prev.matches[k];
    if (!m) return { kind: 'slot', round: prev, index: k };
    const w = matchWinnerId(m);
    if (w) return { kind: 'team', team: w === m.homeTeam.id ? m.homeTeam : m.awayTeam };
    return { kind: 'match', match: m };
  });
}
