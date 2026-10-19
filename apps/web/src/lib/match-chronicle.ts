import type { MatchEvent, MatchStatus } from '@/lib/api/types';

/**
 * Crónica de datos de un partido terminado (C3). Solo hechos derivados de los
 * eventos y del marcador: remontada, hat-trick, gol en los últimos minutos,
 * portería a cero y tanda de penaltis. Si no hay acta suficiente, no hay frase.
 */

export type ChronicleKind = 'comeback' | 'hat_trick' | 'late_goal' | 'clean_sheet' | 'shootout';

export interface ChronicleFact {
  kind: ChronicleKind;
  teamId?: string;
  playerId?: string;
  /** Nombre del jugador tal como viene en el acta (para la frase). */
  playerName?: string;
  /** Goles del jugador en el partido. */
  goals?: number;
  /** Minuto del gol. */
  minute?: number;
}

export interface ChronicleInput {
  status: MatchStatus;
  score: { home: number | null; away: number | null };
  homeTeamId: string;
  awayTeamId: string;
  winType?: 'regular' | 'overtime' | 'penalties' | null;
  events: MatchEvent[];
}

function goalsFor(events: MatchEvent[], side: 'home' | 'away', maxPeriod?: number): number {
  return events.filter((e) =>
    e.eventType === 'goal'
    && e.isHomeTeam === (side === 'home')
    && (maxPeriod === undefined || (e.period !== null && e.period <= maxPeriod)),
  ).length;
}

export function buildMatchChronicle(input: ChronicleInput): ChronicleFact[] {
  if (input.status !== 'finished') return [];
  const home = input.score.home;
  const away = input.score.away;
  if (home === null || away === null) return [];

  const facts: ChronicleFact[] = [];
  const homeWon = home > away;
  const awayWon = away > home;

  // Remontada: perdía al descanso y ganó al final. Solo con goles de 1.ª parte
  // identificados; si el acta no trae periodo, no se deduce.
  const firstHalfGoals = input.events.filter((e) => e.eventType === 'goal' && e.period !== null);
  if (firstHalfGoals.length > 0) {
    const h1 = goalsFor(input.events, 'home', 1);
    const a1 = goalsFor(input.events, 'away', 1);
    if (homeWon && h1 < a1) facts.push({ kind: 'comeback', teamId: input.homeTeamId });
    else if (awayWon && a1 < h1) facts.push({ kind: 'comeback', teamId: input.awayTeamId });
  }

  // Hat-trick: 3 o más goles del mismo jugador.
  const byPlayer = new Map<string, { name: string; goals: number }>();
  for (const e of input.events) {
    if (e.eventType !== 'goal' || !e.player) continue;
    const cur = byPlayer.get(e.player.id) ?? {
      name: `${e.player.firstName} ${e.player.lastName}`.trim(),
      goals: 0,
    };
    cur.goals += 1;
    byPlayer.set(e.player.id, cur);
  }
  for (const [playerId, p] of byPlayer) {
    if (p.goals >= 3) facts.push({ kind: 'hat_trick', playerId, playerName: p.name, goals: p.goals });
  }

  // Gol del ganador en los últimos cinco minutos (minuto 45+ en un partido de 50).
  const goals = input.events
    .filter((e) => e.eventType === 'goal' && e.minute !== null)
    .sort((a, b) => (a.minute ?? 0) - (b.minute ?? 0));
  const last = goals[goals.length - 1];
  if (last && (last.minute ?? 0) >= 45 && last.isHomeTeam === homeWon) {
    facts.push({ kind: 'late_goal', teamId: last.isHomeTeam ? input.homeTeamId : input.awayTeamId, minute: last.minute ?? undefined });
  }

  // Portería a cero.
  if (home === 0 || away === 0) {
    facts.push({ kind: 'clean_sheet', teamId: home === 0 ? input.awayTeamId : input.homeTeamId });
  }

  // Tanda de penaltis.
  if (input.winType === 'penalties') {
    facts.push({ kind: 'shootout', teamId: homeWon ? input.homeTeamId : input.awayTeamId });
  }

  // Sin duplicar "remontada" y "gol tardío" no pasa nada: son hechos distintos.
  return facts;
}
