/**
 * Lectura visual de la previa: en cada métrica del cruce, qué parte de la barra
 * es de cada equipo y quién sale mejor (en faltas, tarjetas o minutos por gol,
 * menos es mejor). Y el balance de los precedentes. Puro y testeable.
 */
import type { CrossMetric, CrossMetricKey, HeadToHeadMatch } from '@sports/core/content-summary';

/** Métricas en las que el valor más bajo es el bueno. */
const LOWER_IS_BETTER = new Set<CrossMetricKey>(['minutes_goal', 'fouls', 'cards']);
/** Sin lectura de "mejor": depende de si son a favor o en contra. */
const NEUTRAL = new Set<CrossMetricKey>(['direct_fouls']);

export interface DuelBar {
  key: CrossMetricKey;
  /** 0–1: parte de la barra de cada lado (suman 1). */
  homeShare: number;
  awayShare: number;
  better: 'home' | 'away' | null;
}

export function duelBar(m: CrossMetric): DuelBar {
  const h = m.home ?? 0;
  const a = m.away ?? 0;
  const total = h + a;
  const homeShare = total > 0 ? h / total : 0.5;
  let better: DuelBar['better'] = null;
  if (m.home != null && m.away != null && h !== a && !NEUTRAL.has(m.key)) {
    const homeHigher = h > a;
    better = LOWER_IS_BETTER.has(m.key) ? (homeHigher ? 'away' : 'home') : (homeHigher ? 'home' : 'away');
  }
  return { key: m.key, homeShare, awayShare: 1 - homeShare, better };
}

/** Balance de precedentes desde el punto de vista del local del partido que se previsualiza. */
export function headToHeadBalance(list: HeadToHeadMatch[], homeTeamId: string) {
  const b = { homeWins: 0, draws: 0, awayWins: 0, homeGoals: 0, awayGoals: 0 };
  for (const m of list) {
    if (m.homeScore == null || m.awayScore == null || !m.homeTeamId) continue;
    const ourHome = m.homeTeamId === homeTeamId;
    const ours = ourHome ? m.homeScore : m.awayScore;
    const theirs = ourHome ? m.awayScore : m.homeScore;
    b.homeGoals += ours;
    b.awayGoals += theirs;
    if (ours > theirs) b.homeWins++; else if (ours < theirs) b.awayWins++; else b.draws++;
  }
  return b;
}
