/** Percentiles de jugador dentro de una temporada (C6). Puro y testeable. */

export interface PeerPlayer {
  playerId: string;
  pj: number;
  goals: number;
  assists: number;
  penaltiesTotal: number;
  penaltiesScored: number;
}

export type PlayerMetricKind = 'goals_per_match' | 'assists_per_match' | 'participation' | 'penalty_pct';

export interface PlayerPercentileMetric {
  kind: PlayerMetricKind;
  value: number;
  /** 1 = mejor. Los empates comparten puesto. */
  rank: number;
  /** Porcentaje de jugadores de la muestra a los que iguala o supera. */
  percentile: number;
  /** Tamaño de la muestra (jugadores con actividad suficiente). */
  peers: number;
}

const MIN_PJ = 5;
const MIN_PENALTIES = 3;
const MIN_PEERS = 3;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function buildPlayerPercentiles(playerId: string, players: PeerPlayer[]): PlayerPercentileMetric[] {
  const sample = players.filter((p) => p.pj >= MIN_PJ);
  const player = sample.find((p) => p.playerId === playerId);
  if (!player) return [];

  const out: PlayerPercentileMetric[] = [];
  const add = (kind: PlayerMetricKind, value: number, pool: number[]) => {
    if (pool.length < MIN_PEERS) return;
    const better = pool.filter((v) => v > value + 1e-9).length;
    out.push({
      kind,
      value: kind === 'penalty_pct' ? Math.round(value) : round2(value),
      rank: better + 1,
      percentile: Math.max(1, Math.round(((pool.length - better) / pool.length) * 100)),
      peers: pool.length,
    });
  };

  const per = (n: number) => n / player.pj;
  add('goals_per_match', per(player.goals), sample.map((p) => p.goals / p.pj));
  add('assists_per_match', per(player.assists), sample.map((p) => p.assists / p.pj));
  add('participation', per(player.goals + player.assists), sample.map((p) => (p.goals + p.assists) / p.pj));

  if (player.penaltiesTotal >= MIN_PENALTIES) {
    const value = (player.penaltiesScored / player.penaltiesTotal) * 100;
    const pool = sample
      .filter((p) => p.penaltiesTotal >= MIN_PENALTIES)
      .map((p) => (p.penaltiesScored / p.penaltiesTotal) * 100);
    add('penalty_pct', value, pool);
  }
  return out;
}
