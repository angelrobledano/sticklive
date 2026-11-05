import type { MatchEvent, MatchStats } from '@sports/core/api';

/**
 * Crónica de datos de un partido terminado (C3, ampliada).
 *
 * Solo hechos derivados del acta: goles por parte, primer gol, remontada,
 * igualada final, rachas de goles, falta directa, faltas, tiempos muertos,
 * hat-trick, gol tardío, portería a cero y tanda de penaltis. Si no hay acta
 * suficiente, no hay frase.
 */

export type ChronicleKind =
  | 'comeback'
  | 'turnaround'
  | 'hat_trick'
  | 'late_goal'
  | 'clean_sheet'
  | 'shootout'
  | 'opening_goal'
  | 'late_equalizer'
  | 'period_goals'
  | 'goal_flurry'
  | 'direct_foul_goal'
  | 'fouls'
  | 'timeouts';

export interface ChronicleFact {
  kind: ChronicleKind;
  teamId?: string;
  /** Para hechos que comparan a los dos equipos (faltas, tiempos muertos...). */
  teamIds?: string[];
  playerId?: string;
  /** Nombre del jugador tal como viene en el acta (para la frase). */
  playerName?: string;
  /** Goles del jugador en el partido (hat-trick). */
  goals?: number;
  /** Minuto global (1-50) del gol. */
  minute?: number;
  values?: Record<string, number | string>;
}

export interface ChronicleInput {
  status: string;
  score: { home: number | null; away: number | null };
  homeTeamId: string;
  awayTeamId: string;
  winType?: 'regular' | 'overtime' | 'penalties' | null;
  events: MatchEvent[];
  stats?: MatchStats | null;
  penaltyShootout?: { home: Array<{ player: string; scored: boolean }>; away: Array<{ player: string; scored: boolean }> } | null;
}

interface Goal {
  event: MatchEvent;
  minute: number;
  period: number;
}

const PERIOD_MINUTES = 25;

function globalMinute(event: MatchEvent): number | null {
  if (event.minute === null) return null;
  const period = event.period ?? 1;
  return (period - 1) * PERIOD_MINUTES + event.minute;
}

function playerName(event: MatchEvent): string | undefined {
  return event.player ? `${event.player.firstName} ${event.player.lastName}`.trim() : undefined;
}

function goalEvents(events: MatchEvent[]): Goal[] {
  return events
    .filter((e) => e.eventType === 'goal' && globalMinute(e) !== null)
    .map((e) => ({ event: e, minute: globalMinute(e)!, period: e.period ?? 1 }))
    .sort((a, b) => a.minute - b.minute);
}

function goalsFor(goals: Goal[], side: 'home' | 'away', period?: number): number {
  return goals.filter((g) => g.event.isHomeTeam === (side === 'home')
    && (period === undefined || g.period === period)).length;
}

export function buildMatchChronicle(input: ChronicleInput): ChronicleFact[] {
  if (input.status !== 'finished') return [];
  const home = input.score.home;
  const away = input.score.away;
  if (home === null || away === null) return [];

  const facts: ChronicleFact[] = [];
  const goals = goalEvents(input.events);
  const homeWon = home > away;
  const awayWon = away > home;

  // Tanda de penaltis: resultado, rondas y acierto.
  if (input.winType === 'penalties' && input.penaltyShootout) {
    const h = input.penaltyShootout.home;
    const a = input.penaltyShootout.away;
    const homeScored = h.filter((k) => k.scored).length;
    const awayScored = a.filter((k) => k.scored).length;
    const winner = homeScored > awayScored ? input.homeTeamId : input.awayTeamId;
    facts.push({
      kind: 'shootout',
      teamId: winner,
      values: {
        home: homeScored,
        away: awayScored,
        rounds: Math.max(h.length, a.length),
        scored: homeScored + awayScored,
        attempts: h.length + a.length,
      },
    });
  }

  // Remontada completa: perdía al descanso y ganó.
  if (goals.length > 0) {
    const h1 = goalsFor(goals, 'home', 1);
    const a1 = goalsFor(goals, 'away', 1);
    if (homeWon && h1 < a1) facts.push({ kind: 'comeback', teamId: input.homeTeamId });
    else if (awayWon && a1 < h1) facts.push({ kind: 'comeback', teamId: input.awayTeamId });
  }

  // Remontada parcial: un equipo estuvo por detrás y llegó a ir por delante,
  // aunque el partido acabase empatado (caso de la final Argentina-Francia).
  let h = 0;
  let a = 0;
  let homeWasBehind = false;
  let awayWasBehind = false;
  let homeTurned = false;
  let awayTurned = false;
  for (const g of goals) {
    if (g.event.isHomeTeam) h++; else a++;
    if (h < a) homeWasBehind = true;
    if (a < h) awayWasBehind = true;
    if (h > a && homeWasBehind) homeTurned = true;
    if (a > h && awayWasBehind) awayTurned = true;
  }
  if (awayTurned && !awayWon) facts.push({ kind: 'turnaround', teamId: input.awayTeamId });
  if (homeTurned && !homeWon) facts.push({ kind: 'turnaround', teamId: input.homeTeamId });

  // Goles por parte.
  if (goals.length > 0 && goals.every((g) => g.period === 1 || g.period === 2)) {
    facts.push({
      kind: 'period_goals',
      teamIds: [input.homeTeamId, input.awayTeamId],
      values: {
        homeFirst: goalsFor(goals, 'home', 1),
        homeSecond: goalsFor(goals, 'home', 2),
        awayFirst: goalsFor(goals, 'away', 1),
        awaySecond: goalsFor(goals, 'away', 2),
      },
    });
  }

  // Primer gol.
  const first = goals[0];
  if (first) {
    facts.push({
      kind: 'opening_goal',
      teamId: first.event.isHomeTeam ? input.homeTeamId : input.awayTeamId,
      playerId: first.event.player?.id ?? undefined,
      playerName: playerName(first.event),
      minute: first.minute,
      values: { minute: first.minute },
    });
  }

  // Igualada final en los últimos minutos.
  const last = goals[goals.length - 1];
  if (last && home === away && last.minute >= 40) {
    let beforeHome = 0;
    let beforeAway = 0;
    for (const g of goals) {
      if (g === last) break;
      if (g.event.isHomeTeam) beforeHome++; else beforeAway++;
    }
    const teamWasBehind = last.event.isHomeTeam ? beforeHome < beforeAway : beforeAway < beforeHome;
    if (teamWasBehind) {
      facts.push({
        kind: 'late_equalizer',
        teamId: last.event.isHomeTeam ? input.homeTeamId : input.awayTeamId,
        playerId: last.event.player?.id ?? undefined,
        playerName: playerName(last.event),
        minute: last.minute,
        values: { minute: last.minute, home, away },
      });
    }
  }

  // Dos o más goles del mismo equipo en cinco minutos.
  const flurry = bestFlurry(goals, input.homeTeamId, input.awayTeamId);
  if (flurry) facts.push(flurry);

  // Gol de falta directa.
  for (const event of input.events) {
    if (event.eventType === 'direct_foul' && /marcad|gol/i.test(event.detail ?? '')) {
      const minute = globalMinute(event);
      if (minute !== null) {
        facts.push({
          kind: 'direct_foul_goal',
          teamId: event.isHomeTeam ? input.homeTeamId : input.awayTeamId,
          playerId: event.player?.id ?? undefined,
          playerName: playerName(event),
          minute,
          values: { minute },
        });
      }
    }
  }

  // Hat-trick.
  const byPlayer = new Map<string, { name: string; goals: number }>();
  for (const g of goals) {
    if (!g.event.player) continue;
    const cur = byPlayer.get(g.event.player.id) ?? {
      name: playerName(g.event) ?? '',
      goals: 0,
    };
    cur.goals += 1;
    byPlayer.set(g.event.player.id, cur);
  }
  for (const [playerId, p] of byPlayer) {
    if (p.goals >= 3) facts.push({ kind: 'hat_trick', playerId, playerName: p.name, goals: p.goals });
  }

  // Gol del ganador en los últimos cinco minutos (minuto global 45+).
  if (last && last.minute >= 45 && (homeWon || awayWon)) {
    const lastIsWinner = last.event.isHomeTeam ? homeWon : awayWon;
    if (lastIsWinner) {
      facts.push({
        kind: 'late_goal',
        teamId: last.event.isHomeTeam ? input.homeTeamId : input.awayTeamId,
        minute: last.minute,
        values: { minute: last.minute },
      });
    }
  }

  // Portería a cero.
  if (home === 0 || away === 0) {
    facts.push({ kind: 'clean_sheet', teamId: home === 0 ? input.awayTeamId : input.homeTeamId });
  }

  const stats = input.stats;
  if (stats) {
    const totalFouls = stats.homeFouls + stats.awayFouls;
    if (totalFouls >= 10) {
      facts.push({
        kind: 'fouls',
        teamIds: [input.homeTeamId, input.awayTeamId],
        values: { home: stats.homeFouls, away: stats.awayFouls },
      });
    }
    const timeouts = (stats.homeTimeouts ?? 0) + (stats.awayTimeouts ?? 0);
    if (timeouts >= 5) {
      facts.push({
        kind: 'timeouts',
        teamIds: [input.homeTeamId, input.awayTeamId],
        values: { home: stats.homeTimeouts ?? 0, away: stats.awayTimeouts ?? 0 },
      });
    }
  }

  return facts;
}

function bestFlurry(goals: Goal[], homeTeamId: string, awayTeamId: string): ChronicleFact | null {
  let best: { teamId: string; n: number; from: number; to: number } | null = null;
  for (const isHome of [true, false]) {
    const own = goals.filter((g) => g.event.isHomeTeam === isHome);
    for (let i = 0; i < own.length; i++) {
      for (let j = i + 1; j < own.length; j++) {
        const span = own[j]!.minute - own[i]!.minute;
        if (span > 5) break;
        const n = j - i + 1;
        if (!best || n > best.n || (n === best.n && span < best.to - best.from)) {
          best = { teamId: isHome ? homeTeamId : awayTeamId, n, from: own[i]!.minute, to: own[j]!.minute };
        }
      }
    }
  }
  return best && best.n >= 2
    ? { kind: 'goal_flurry', teamId: best.teamId, values: { n: best.n, from: best.from, to: best.to } }
    : null;
}
