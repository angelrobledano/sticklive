import type { PlayerDetail } from '@/lib/api/types';

/** Hechos de un jugador calculados solo con sus totales de temporada (C6). */

export type PlayerFactKind = 'goals_per_match' | 'assists_per_match' | 'participation' | 'penalty_pct' | 'discipline';

export interface PlayerFact {
  kind: PlayerFactKind;
  value: number;
  extra?: number;
}

export function buildPlayerFacts(data: PlayerDetail): PlayerFact[] {
  const t = data.seasonTotals;
  if (!t || t.pj < 5) return [];
  const facts: PlayerFact[] = [];
  const per = (n: number) => Math.round((n / t.pj) * 10) / 10;

  if (t.goals >= 5) facts.push({ kind: 'goals_per_match', value: per(t.goals), extra: t.goals });
  if (t.assists >= 3) facts.push({ kind: 'assists_per_match', value: per(t.assists), extra: t.assists });
  if (t.goals + t.assists >= 8) facts.push({ kind: 'participation', value: per(t.goals + t.assists), extra: t.goals + t.assists });
  if (t.penaltiesTotal >= 3) {
    facts.push({ kind: 'penalty_pct', value: Math.round((t.penaltiesScored / t.penaltiesTotal) * 100), extra: t.penaltiesTotal });
  }
  if (t.blueCards + t.redCards > 0) facts.push({ kind: 'discipline', value: t.blueCards, extra: t.redCards });
  return facts;
}
