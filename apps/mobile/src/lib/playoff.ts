import type { SeasonMatch } from '@/src/lib/api/types';

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
 * se deriva del marcador. Un empate sin ganador explícito no se atribuye a nadie.
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
      let winsA = 0;
      let winsB = 0;
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
 */
export function seriesWinnerId(serie: PlayoffSeries): string | null {
  if (serie.games.some((g) => g.status === 'live')) return null;
  if (serie.games.some((g) => g.status !== 'finished')) return null;
  if (serie.winsA === serie.winsB) return null;
  return serie.winsA > serie.winsB ? serie.teamA.id : serie.teamB.id;
}

const STAGE_BUCKET: Partial<Record<string, PlayoffPhase>> = {
  quarters: 'Cuartos',
  semis: 'Semis',
  final: 'Final',
};

/**
 * Reparte los partidos de playoff en fases. Manda la fase EXPLÍCITA de la
 * fuente (`stage`); sin ella (temporadas heredadas), el roundNumber legado
 * (1=QF, 2=SF, 3=F, 0=colocación).
 */
export function groupByPhase(matches: SeasonMatch[]): Record<PlayoffPhase, SeasonMatch[]> {
  const buckets: Record<PlayoffPhase, SeasonMatch[]> = { Cuartos: [], Semis: [], Final: [] };
  const playoffMatches = matches.filter((m) => m.roundType === 'playoff');

  // Si no hay stages explícitos, verificar si es un formato Final Four (2 semifinales y 1 final entre 4 equipos)
  // donde la fuente haya etiquetado todos los partidos bajo la misma ronda o roundNumber
  const needsFinalFourInference =
    playoffMatches.length === 3 && playoffMatches.every((m) => !m.stage);

  if (needsFinalFourInference) {
    const sorted = [...playoffMatches].sort((a, b) =>
      (a.scheduledAt ?? '') < (b.scheduledAt ?? '') ? -1 : 1,
    );
    buckets.Semis.push(sorted[0]!, sorted[1]!);
    buckets.Final.push(sorted[2]!);
    return buckets;
  }

  for (const m of playoffMatches) {
    if (m.stage) {
      const b = STAGE_BUCKET[m.stage];
      if (b) buckets[b].push(m);
      continue;
    }
    const name = (m.roundName ?? '').toLowerCase();
    if (name.includes('cuarto') || name.includes('1/4')) {
      buckets.Cuartos.push(m);
      continue;
    }
    if (name.includes('semi') || name.includes('1/2')) {
      buckets.Semis.push(m);
      continue;
    }
    const rn = m.roundNumber ?? 1;
    if (rn === 0) continue;
    buckets[rn >= 3 ? 'Final' : rn === 2 ? 'Semis' : 'Cuartos'].push(m);
  }
  return buckets;
}

/**
 * Serie de colocación 9º–10º (roundNumber derivado = 0 o stage = placement).
 */
export function placementMatches(matches: SeasonMatch[]): SeasonMatch[] {
  return matches.filter(
    (m) => m.roundType === 'playoff' && (m.stage ? m.stage === 'placement' : m.roundNumber === 0),
  );
}

/**
 * IDs de equipos que han avanzado desde una fase (los que aparecen en alguna serie de la fase siguiente).
 */
export function advancedFrom(nextPhaseSeries: PlayoffSeries[]): Set<string> {
  const ids = new Set<string>();
  for (const s of nextPhaseSeries) {
    ids.add(s.teamA.id);
    ids.add(s.teamB.id);
  }
  return ids;
}
