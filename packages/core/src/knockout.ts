import type { TeamSeasonInfo } from './api';
import { gameWinnerId } from './playoff';
import { matchPhaseKey, playoffPhaseKey, type PlayoffPhaseKey } from './phase-keys';
import { STAGE_ORDER, type KnockoutStage } from '@sports/shared-types';

/**
 * Síntesis de la participación de un equipo en una competición ELIMINATORIA
 * (Supercopa, Copa del Rey, playoffs, Final Four…): fases, resultado por
 * eliminatoria, avance/eliminación y título.
 *
 * La competición eliminatoria se identifica por el FORMATO DECLARADO en
 * `competition_sources.external_ids.format` ('bracket' | 'final_four'), igual
 * que hace la vista de competición. Con formato desconocido hay un fallback
 * defensivo (sin clasificación y todos los partidos de eliminatoria).
 *
 * La fuente da la fase de calidad variable (lecciones de los datos reales):
 *  - Copa del Rey: rondas reales con roundNumber 1/2/3 (el nombre puede ser
 *    basura: todo se llama "FINAL").
 *  - Supercopa 2025/26: UNA única ronda "FINAL" para semis y final.
 *  - OK Liga Bronce Eliminatoria: ida/vuelta sin rondas.
 *  - Supercopa "Histórico": partidos sin fechas ni rondas.
 * Por eso la asignación de fases es conservadora: fase EXPLÍCITA de la fuente
 * (`stage`, la API la da desde la migración 072) > rondas reales > cadena de
 * avance por cronología > nombre de ronda, y si no hay estructura fiable se
 * devuelve `incomplete` (lista simple de partidos, sin fases inventadas). Las
 * deducciones solo actúan ya sobre temporadas heredadas sin `stage`.
 *
 * Funciones puras y testeadas (mismo patrón que `playoff.ts`).
 */

/** Mínimo estructural que necesita el módulo (lo cumple `TeamMatchSummary`). */
export interface KnockoutMatchInput {
  id: string;
  status: string;
  scheduledAt: string | null;
  finishedAt?: string | null;
  score: { home: number | null; away: number | null };
  homeTeam: { id: string; name: string; shortName: string | null; logoUrl: string | null };
  awayTeam: { id: string; name: string; shortName: string | null; logoUrl: string | null };
  roundId?: string | null;
  roundNumber?: number | null;
  roundName?: string | null;
  roundType?: string | null;
  /** Fase eliminatoria EXPLÍCITA de la fuente (manda sobre cualquier deducción). */
  stage?: string | null;
  winnerTeamId?: string | null;
  winType?: 'regular' | 'overtime' | 'penalties' | null;
}

export type KnockoutPhaseKey = PlayoffPhaseKey;

export { matchPhaseKey, playoffPhaseKey };

export interface KnockoutSeriesView {
  /** Partidos de la eliminatoria (del equipo), ordenados por fecha. */
  games: KnockoutMatchInput[];
  /** El rival (el otro equipo de la eliminatoria). */
  opponent: KnockoutMatchInput['homeTeam'];
  /** Victorias por partido terminado (no es un marcador agregado). */
  winsFor: number;
  winsAgainst: number;
  /** 'open' = pendiente o en juego: no corona ni elimina. */
  result: 'won' | 'lost' | 'open';
  /** Cómo se decidió (para la etiqueta "pen."/"pr."), si aplica. */
  decidedBy?: 'penalties' | 'overtime';
}

export interface KnockoutPhaseView {
  /** Fase canónica resuelta; `null` = ronda no reconocida (mostrar su nombre). */
  phase: KnockoutPhaseKey | null;
  roundName: string | null;
  roundNumber: number | null;
  /** Eliminatorias DEL EQUIPO en esta fase (normalmente 1). */
  series: KnockoutSeriesView[];
}

export interface KnockoutSummary {
  /** El equipo ganó la final. */
  champion: boolean;
  /** Estructura insuficiente: no se derivan fases; mostrar los partidos en crudo. */
  incomplete: boolean;
  /** Fases CON participación del equipo, en orden cronológico (semis → final). */
  phases: KnockoutPhaseView[];
  /** Fase donde quedó eliminado (`null` si campeón, en juego o hueco de datos). */
  eliminatedIn: KnockoutPhaseKey | null;
  /** Partido → fase, para etiquetar el calendario. Vacío en modo incompleto. */
  phaseByMatch: Map<string, KnockoutPhaseView>;
  /** Partidos del equipo (en modo incompleto, la lista que se muestra). */
  matches: KnockoutMatchInput[];
}

// ─── Detección del formato ─────────────────────────────────────────────────

const KNOCKOUT_FORMATS = new Set(['bracket', 'final_four']);

export function isKnockoutFormat(format: string | null | undefined): boolean {
  return format != null && KNOCKOUT_FORMATS.has(format);
}

/**
 * ¿La temporada mostrada es de eliminatorias? El formato declarado manda; el
 * fallback defensivo cubre competiciones sin formato declarado (payloads
 * antiguos): sin fila de clasificación y con TODOS los partidos de
 * eliminatoria. En una liga real es imposible (siempre hay jornadas regulares).
 */
export function isKnockoutSeason(
  season: Pick<TeamSeasonInfo, 'competitionFormat'> | null | undefined,
  standing: unknown,
  matches: readonly KnockoutMatchInput[],
): boolean {
  if (isKnockoutFormat(season?.competitionFormat)) return true;
  // El formato no declarado llega normalizado a 'league', así que 'league'
  // explícito no descarta el fallback. En una liga real es inofensivo: un
  // equipo de liga siempre tiene jornadas regulares, `every` ya lo excluye.
  return (
    standing == null &&
    matches.length > 0 &&
    matches.every((m) => m.roundType === 'playoff' || m.roundType === 'cup')
  );
}

// ─── Agrupación por eliminatoria (pareja de equipos) ───────────────────────

interface SeriesGroup {
  games: KnockoutMatchInput[];
  teamA: KnockoutMatchInput['homeTeam'];
  teamB: KnockoutMatchInput['homeTeam'];
  firstDate: number | null;
}

function matchDate(g: KnockoutMatchInput): number | null {
  const iso = g.scheduledAt ?? g.finishedAt ?? null;
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : t;
}

function groupByPair(matches: readonly KnockoutMatchInput[]): SeriesGroup[] {
  const map = new Map<string, KnockoutMatchInput[]>();
  for (const g of matches) {
    const key = [g.homeTeam.id, g.awayTeam.id].sort().join('|');
    const arr = map.get(key);
    if (arr) arr.push(g);
    else map.set(key, [g]);
  }
  return [...map.values()].map((games) => {
    games.sort((a, b) => (matchDate(a) ?? 0) - (matchDate(b) ?? 0));
    const ref = games[0]!;
    return {
      games,
      teamA: ref.homeTeam,
      teamB: ref.awayTeam,
      firstDate: games.map(matchDate).reduce<number | null>(
        (min, d) => (d != null && (min == null || d < min) ? d : min), null),
    };
  });
}

function involves(s: SeriesGroup, teamId: string): boolean {
  return s.teamA.id === teamId || s.teamB.id === teamId;
}

/** Ganador de la eliminatoria si ya está decidida (todas terminadas, sin empate). */
function seriesWinner(s: SeriesGroup): string | null {
  if (s.games.some((g) => g.status !== 'finished')) return null;
  let winsA = 0, winsB = 0;
  for (const g of s.games) {
    const w = gameWinnerId(g);
    if (w === s.teamA.id) winsA++;
    else if (w === s.teamB.id) winsB++;
  }
  if (winsA === winsB) return null;
  return winsA > winsB ? s.teamA.id : s.teamB.id;
}

// ─── Asignación de fases ───────────────────────────────────────────────────

/** Todas las eliminatorias traen su fase explícita de la fuente (sin colocación). */
function hasExplicitStages(series: SeriesGroup[]): boolean {
  return series.length > 0
    && series.every((s) => s.games.every((g) => matchPhaseKey({ stage: g.stage }) !== null));
}

/** Fases canónicas por posición DESDE EL FINAL (0=final, 1=semis, …). */
const PHASE_BY_RANK: Array<KnockoutPhaseKey | null> = [
  'final', 'semis', 'quarters', 'round_of_16',
];

interface PhasedSeries {
  serie: SeriesGroup;
  phase: KnockoutPhaseKey | null;
  roundName: string | null;
  roundNumber: number | null;
}

/**
 * Etiqueta de una fase para mostrar. Fase canónica resuelta → su clave
 * `playoffs.*`; si no, el nombre propio de la ronda (no traducible tal cual,
 * misma convención que la vista de competición).
 */
export function knockoutPhaseLabel(
  p: { phase: KnockoutPhaseKey | null; roundName: string | null },
  t: (key: string) => string,
): string {
  if (p.phase) return t(`playoffs.${p.phase}`);
  return p.roundName || t('match_tabs.playoffs');
}

/**
 * Asigna la fase a cada eliminatoria de la temporada.
 *
 * 1. Rondas reales (≥2 rondas distintas): la posición desde el final manda —
 *    el nombre puede estar repetido en todas (Copa del Rey: todo "FINAL").
 * 2. Una sola ronda (o ninguna): cadena de avance por cronología — la última
 *    eliminatoria es la final si sus dos equipos vienen de ganar eliminatorias
 *    anteriores. Si la cadena no se puede confirmar (todo pendiente), cae al
 *    nombre de la ronda y, en último caso, a "semis" (estado pre-final), nunca
 *    inventa una final.
 */
function assignPhases(series: SeriesGroup[]): PhasedSeries[] {
  if (series.length === 0) return [];

  // 0) Fase EXPLÍCITA de la fuente en todas las eliminatorias: no se deduce
  //    nada (ni rango por ronda ni cronología). Orden de juego y, a igualdad,
  //    fecha.
  if (hasExplicitStages(series)) {
    const rank = (s: SeriesGroup) => STAGE_ORDER[s.games[0]!.stage as KnockoutStage] ?? 99;
    return [...series]
      .sort((a, b) => rank(a) - rank(b) || (a.firstDate ?? 0) - (b.firstDate ?? 0))
      .map((s) => ({
        serie: s,
        phase: matchPhaseKey(s.games[0]!),
        roundName: s.games[0]?.roundName ?? null,
        roundNumber: s.games[0]?.roundNumber ?? null,
      }));
  }

  // 1) Rondas reales: agrupar por ronda y ordenar por número (o primera fecha).
  const roundGroups = new Map<string, SeriesGroup[]>();
  for (const s of series) {
    const rid = s.games[0]?.roundId;
    if (!rid) continue;
    const arr = roundGroups.get(rid);
    if (arr) arr.push(s);
    else roundGroups.set(rid, [s]);
  }

  if (roundGroups.size >= 2) {
    // Ronda de 3.er/4.º puesto (World Skate): fuera de la escalera por el
    // título — se muestra como fase propia al final, sin afectar al rango.
    // El rango se asigna POR RONDA (una ronda agrupa varias eliminatorias).
    const ladder: SeriesGroup[][] = [];
    const thirdPlace: SeriesGroup[] = [];
    for (const groups of roundGroups.values()) {
      const name = groups[0]!.games[0]?.roundName ?? null;
      if (playoffPhaseKey(name, null) === 'third_place') thirdPlace.push(...groups);
      else ladder.push(groups);
    }

    const out: PhasedSeries[] = [];
    ladder.sort((a, b) => {
      const na = a[0]!.games[0]?.roundNumber ?? null;
      const nb = b[0]!.games[0]?.roundNumber ?? null;
      if (na != null && nb != null && na !== nb) return na - nb;
      return (a[0]!.firstDate ?? 0) - (b[0]!.firstDate ?? 0);
    });
    ladder.forEach((groups, idx) => {
      const rank = ladder.length - 1 - idx; // 0 = última ronda = final
      const phase = rank < PHASE_BY_RANK.length ? PHASE_BY_RANK[rank]! : null;
      for (const s of groups) {
        out.push({
          serie: s,
          phase,
          roundName: s.games[0]?.roundName ?? null,
          roundNumber: s.games[0]?.roundNumber ?? null,
        });
      }
    });
    // Clasificación a 3: después del título (orden de lectura: camino → resto).
    for (const s of thirdPlace) {
      out.push({ serie: s, phase: null, roundName: s.games[0]?.roundName ?? null, roundNumber: s.games[0]?.roundNumber ?? null });
    }
    return out;
  }

  // 2) Una sola ronda (o ninguna): cronología + cadena de avance.
  const dated = series.every((s) => s.firstDate != null);
  if (!dated) {
    // Sin fechas no se puede ordenar: la estructura no es fiable.
    return series.map((s) => ({ serie: s, phase: null, roundName: s.games[0]?.roundName ?? null, roundNumber: s.games[0]?.roundNumber ?? null }));
  }

  const ordered = [...series].sort((a, b) => (a.firstDate ?? 0) - (b.firstDate ?? 0));
  const n = ordered.length;
  const last = ordered[n - 1]!;
  const roundName = last.games[0]?.roundName ?? null;
  const roundNumber = last.games[0]?.roundNumber ?? null;
  // Sólo el NOMBRE manda aquí (el número de una ronda única no distingue fases:
  // la Supercopa 2025/26 numera como 4 su ronda "FINAL" con semis incluidas).
  const nameKey = playoffPhaseKey(roundName, null);

  if (n === 1) {
    // Eliminatoria única: es la que decide el título (a falta de nombre que
    // diga lo contrario, p. ej. una semifinal huérfana con la final sin datos).
    return [{ serie: last, phase: nameKey ?? 'final', roundName, roundNumber }];
  }

  const earlier = ordered.slice(0, n - 1);
  // Cadena de avance: un equipo sólo reaparece en una fase posterior si ganó
  // la anterior, así que PARTICIPAR en una eliminatoria anterior ya prueba el
  // avance — sin necesidad de que el ganador sea derivable (final en juego,
  // empates sin ganador explícito).
  const lastTeams = [last.teamA.id, last.teamB.id];
  const advanceChain = lastTeams.filter((id) =>
    earlier.some((s) => s.teamA.id === id || s.teamB.id === id),
  ).length;
  const winChain = lastTeams.filter((id) =>
    earlier.some((s) => seriesWinner(s) === id),
  ).length;

  if (advanceChain === 2) {
    // Cadena completa: última = final, las dos anteriores semis, resto cuartos.
    return ordered.map((s, idx) => ({
      serie: s,
      phase: idx === n - 1 ? 'final' : idx >= n - 3 ? 'semis' : 'quarters',
      roundName,
      roundNumber,
    }));
  }

  if (winChain >= 1) {
    // Un finalista viene de ganar una eliminatoria anterior: la última es la
    // final (la semifinal del otro finalista puede faltar en los datos); el
    // resto, semis.
    return ordered.map((s, idx) => ({
      serie: s,
      phase: idx === n - 1 ? 'final' : 'semis',
      roundName,
      roundNumber,
    }));
  }

  // Cadena no confirmable (eliminatorias pendientes): el nombre de la ronda
  // manda si apunta a una fase distinta de la final (p. ej. "SEMIFINALES");
  // si dice "final" para TODAS, es el caso Supercopa (nombre basura): sin
  // cadena confirmada no se atribuye ninguna final.
  const fallback: KnockoutPhaseKey | null = nameKey === 'final' ? 'semis' : nameKey;
  return ordered.map((s) => ({ serie: s, phase: fallback, roundName, roundNumber }));
}

// ─── Vista del equipo ──────────────────────────────────────────────────────

/**
 * ¿La secuencia de eliminatorias forma un cuadro coherente? En una
 * eliminatoria real, el ganador de cada ronda temprana reaparece en una
 * posterior. Un bucket con varias ediciones mezcladas (datos históricos
 * fechados) rompe la cadena. Las dos últimas posiciones quedan exentas: el
 * campeón y los finalistas pueden aún no tener donde avanzar (final sin
 * crear en la fuente).
 */
function bracketLadderConsistent(series: SeriesGroup[]): boolean {
  const ordered = [...series].sort((a, b) => (a.firstDate ?? 0) - (b.firstDate ?? 0));
  const n = ordered.length;
  if (n < 3) return true;
  for (let i = 0; i < n - 2; i++) {
    const s = ordered[i]!;
    // La clasificación a 3.er/4.º puesto no alimenta nada: fuera de la cadena.
    if (playoffPhaseKey(s.games[0]?.roundName ?? null, null) === 'third_place') continue;
    const w = seriesWinner(s);
    if (!w) continue;
    const advances = ordered.slice(i + 1).some(
      (q) => q.teamA.id === w || q.teamB.id === w,
    );
    if (!advances) return false;
  }
  return true;
}

function seriesView(s: SeriesGroup, teamId: string): KnockoutSeriesView {
  const opponent = s.teamA.id === teamId ? s.teamB : s.teamA;
  let winsFor = 0, winsAgainst = 0, open = false;
  for (const g of s.games) {
    if (g.status !== 'finished') { open = true; continue; }
    const w = gameWinnerId(g);
    if (w === teamId) winsFor++;
    else if (w != null) winsAgainst++;
  }
  let result: KnockoutSeriesView['result'] = 'open';
  let decidedBy: KnockoutSeriesView['decidedBy'];
  if (!open) {
    if (winsFor > winsAgainst) result = 'won';
    else if (winsAgainst > winsFor) result = 'lost';
    else {
      // Igualdad de victorias con todo terminado: decide el ganador explícito
      // del último partido (eliminatoria resuelta en penaltis, p. ej.).
      const lastFinished = [...s.games].reverse().find((g) => g.status === 'finished');
      const w = lastFinished ? gameWinnerId(lastFinished) : null;
      if (w === teamId) result = 'won';
      else if (w != null) result = 'lost';
      const wt = lastFinished?.winType;
      if (wt === 'penalties' || wt === 'overtime') decidedBy = wt;
    }
  }
  // Eliminatoria a partido único: la forma en que se decidió ESE partido.
  if (!decidedBy && s.games.length === 1) {
    const wt = s.games[0]!.winType;
    if (wt === 'penalties' || wt === 'overtime') decidedBy = wt;
  }
  return { games: s.games, opponent, winsFor, winsAgainst, result, decidedBy };
}

/**
 * Síntesis de la participación del equipo en la temporada eliminatoria.
 * Devuelve `null` si no hay partidos: el llamante muestra el estado vacío.
 */
export function buildKnockoutSummary(
  teamId: string,
  matches: readonly KnockoutMatchInput[],
): KnockoutSummary | null {
  if (matches.length === 0) return null;

  const mine = matches.filter((m) => m.homeTeam.id === teamId || m.awayTeam.id === teamId);
  if (mine.length === 0) return null;

  const allSeries = groupByPair(matches);

  // Estructura fiable: con rondas reales siempre; por cronología sólo si hay
  // fechas y el cuadro es COHERENTE (los ganadores de las fases tempranas
  // reaparecen en fases posteriores). Sin fechas no se puede ordenar (caso
  // "Histórico": varias ediciones mezcladas); un cuadro con ganadores que no
  // avanzan tampoco lo es. Sin partidos del cuadro no se inventan fases.
  const hasDates = allSeries.every((s) => s.firstDate != null);
  const hasRealRounds = new Set(
    allSeries.map((s) => s.games[0]?.roundId).filter((x): x is string => !!x),
  ).size >= 2;
  const incomplete = !hasExplicitStages(allSeries)
    && !hasRealRounds && (!hasDates || !bracketLadderConsistent(allSeries));

  const phaseByMatch = new Map<string, KnockoutPhaseView>();
  const phases: KnockoutPhaseView[] = [];

  if (incomplete) {
    return { champion: false, incomplete, phases, eliminatedIn: null, phaseByMatch, matches: mine };
  }

  const phased = assignPhases(allSeries);

  // Fases ordenadas cronológicamente (semis → final) con las eliminatorias del
  // equipo; el orden de asignación ya es cronológico en ambos caminos.
  const order: Array<KnockoutPhaseView> = [];
  const byKey = new Map<string, KnockoutPhaseView>();
  for (const { serie, phase, roundName, roundNumber } of phased) {
    if (!involves(serie, teamId)) continue;
    const key = `${phase ?? '?'}:${roundNumber ?? ''}`;
    let view = byKey.get(key);
    if (!view) {
      view = { phase, roundName, roundNumber, series: [] };
      byKey.set(key, view);
      order.push(view);
    }
    view.series.push(seriesView(serie, teamId));
    for (const g of serie.games) phaseByMatch.set(g.id, view);
  }

  // Campeón: ganó la (última) fase de final.
  const finalPhase = order.find((p) => p.phase === 'final');
  const champion = finalPhase?.series.every((s) => s.result === 'won') ?? false;

  // Eliminación: la última fase (leyendo en orden cronológico) con alguna
  // eliminatoria perdida. Ganar una fase posterior (p. ej. el 3.er puesto tras
  // caer en semis) no borra la eliminación.
  let eliminatedIn: KnockoutPhaseKey | null = null;
  if (!champion) {
    for (let i = order.length - 1; i >= 0; i--) {
      if (order[i]!.series.some((s) => s.result === 'lost')) {
        eliminatedIn = order[i]!.phase;
        break;
      }
    }
  }

  return { champion, incomplete, phases: order, eliminatedIn, phaseByMatch, matches: mine };
}
