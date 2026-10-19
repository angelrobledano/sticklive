import type { SeasonMatch } from '@/lib/api/client';

/**
 * Lógica compartida del cuadro de playoff (series al mejor de N).
 * La usan la vista de competición (pestaña Playoffs) y el bracket
 * compacto de la ficha de partido.
 */

export type PlayoffPhase = 'Cuartos' | 'Semis' | 'Final';
export const PLAYOFF_PHASES: PlayoffPhase[] = ['Cuartos', 'Semis', 'Final'];

export interface PlayoffSeries {
  games: SeasonMatch[];
  teamA: SeasonMatch['homeTeam'];
  teamB: SeasonMatch['awayTeam'];
  winsA: number;
  winsB: number;
}

/**
 * Ganador de un partido. El ganador explícito (penaltis/prórroga) manda; si no,
 * se deriva del marcador. Un empate sin ganador explícito no se atribuye a nadie
 * (antes se contaba como victoria del visitante por error).
 *
 * Firma estructural (mínimo que necesita el cálculo) para servir también a los
 * `TeamMatchSummary` de la ficha de equipo, no sólo a `SeasonMatch`.
 */
export function gameWinnerId(g: {
  winnerTeamId?: string | null;
  score: { home: number | null; away: number | null };
  penalties?: { home: number | null; away: number | null } | null;
  homeTeam: { id: string };
  awayTeam: { id: string };
}): string | null {
  if (g.winnerTeamId) return g.winnerTeamId;
  if (g.score.home === null || g.score.away === null) return null;
  if (g.score.home === g.score.away) {
    // Empate sin ganador guardado: lo decide la tanda, si está decidida.
    const p = g.penalties;
    if (!p || p.home == null || p.away == null || p.home === p.away) return null;
    return p.home > p.away ? g.homeTeam.id : g.awayTeam.id;
  }
  return g.score.home > g.score.away ? g.homeTeam.id : g.awayTeam.id;
}

/** Agrupa los partidos de una fase por eliminatoria (pareja de equipos). */
export function buildSeries(games: SeasonMatch[]): PlayoffSeries[] {
  const map = new Map<string, SeasonMatch[]>();
  for (const g of games) {
    const key = [g.homeTeam.id, g.awayTeam.id].sort().join('|');
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(g);
  }
  return [...map.values()]
    .map((gs) => {
      const sorted = [...gs].sort((a, b) => ((a.scheduledAt ?? '') < (b.scheduledAt ?? '') ? -1 : 1));
      const ref = sorted[0]!;
      const teamA = ref.homeTeam;
      const teamB = ref.awayTeam;
      let winsA = 0, winsB = 0;
      for (const g of sorted) {
        if (g.status !== 'finished') continue;
        const winnerId = gameWinnerId(g);
        if (!winnerId) continue;
        if (winnerId === teamA.id) winsA++;
        else if (winnerId === teamB.id) winsB++;
      }
      return { games: sorted, teamA, teamB, winsA, winsB };
    })
    .sort((a, b) => ((a.games[0]!.scheduledAt ?? '') < (b.games[0]!.scheduledAt ?? '') ? -1 : 1));
}

/**
 * Ganador de una serie YA decidida (el campeón, en la final por el título):
 * todas las partidas terminadas, ninguna en juego y un equipo por delante en
 * victorias. Devuelve el id del vencedor o null si la serie sigue abierta.
 *
 * No conocemos el "al mejor de N" de cada torneo, así que no damos la serie por
 * cerrada mientras queden partidas pendientes: esperamos a que terminen todas.
 */
export function seriesWinnerId(serie: PlayoffSeries): string | null {
  if (serie.games.some((g) => g.status === 'live')) return null;
  if (serie.games.some((g) => g.status !== 'finished')) return null;
  if (serie.winsA === serie.winsB) return null;
  return serie.winsA > serie.winsB ? serie.teamA.id : serie.teamB.id;
}

const STAGE_BUCKET: Partial<Record<string, PlayoffPhase>> = { quarters: 'Cuartos', semis: 'Semis', final: 'Final' };

/**
 * Reparte los partidos de playoff en fases. Manda la fase EXPLÍCITA de la
 * fuente (`stage`); sin ella (temporadas heredadas), el roundNumber legado
 * (1=QF, 2=SF, 3=F, 0=colocación).
 */
export function groupByPhase(matches: SeasonMatch[]): Record<PlayoffPhase, SeasonMatch[]> {
  const buckets: Record<PlayoffPhase, SeasonMatch[]> = { Cuartos: [], Semis: [], Final: [] };
  for (const m of matches) {
    if (m.roundType !== 'playoff') continue;
    if (m.stage) {
      const b = STAGE_BUCKET[m.stage];
      if (b) buckets[b].push(m);
      continue; // colocación, 3.er puesto…: fuera de la escalera por el título
    }
    const rn = m.roundNumber ?? 1;
    if (rn === 0) continue; // serie de colocación (9º–10º) — fuera del cuadro por el título
    buckets[rn >= 3 ? 'Final' : rn === 2 ? 'Semis' : 'Cuartos'].push(m);
  }
  return buckets;
}

/**
 * Serie de colocación 9º–10º (roundNumber derivado = 0): los equipos que
 * evitaron el descenso disputan la última plaza europea (WSE Cup). No forma
 * parte del cuadro por el título, pero SÍ debe mostrarse — el orden final
 * decide qué competición europea juega cada club.
 */
export function placementMatches(matches: SeasonMatch[]): SeasonMatch[] {
  return matches.filter((m) =>
    m.roundType === 'playoff' && (m.stage ? m.stage === 'placement' : m.roundNumber === 0));
}

/**
 * IDs de equipos que han avanzado desde una fase: los que aparecen en
 * alguna serie de la fase siguiente. Sirve para pintar el check de
 * "clasificado" en el bracket.
 */
export function advancedFrom(nextPhaseSeries: PlayoffSeries[]): Set<string> {
  const ids = new Set<string>();
  for (const s of nextPhaseSeries) {
    ids.add(s.teamA.id);
    ids.add(s.teamB.id);
  }
  return ids;
}
