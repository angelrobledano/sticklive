/**
 * Helpers de presentación para la pestaña de plantilla de equipo.
 */

export function goalsWord(count: number, locale: string): string {
  if (count === 1) {
    if (locale === 'en') return 'goal';
    if (locale === 'fr') return 'but';
    if (locale === 'pt') return 'golo';
    return 'gol';
  }
  if (locale === 'en') return 'goals';
  if (locale === 'ca') return 'gols';
  if (locale === 'fr') return 'buts';
  if (locale === 'pt') return 'golos';
  if (locale === 'it') return 'gol';
  return 'goles';
}

export function formatSquadPlayerStats(
  player: { goals: number; blueCards?: number | null; redCards?: number | null },
  locale: string,
): {
  hasStats: boolean;
  goalLabel: string;
  blueCardsCount: number;
  redCardsCount: number;
} {
  const blueCardsCount = player.blueCards && player.blueCards > 0 ? player.blueCards : 0;
  const redCardsCount = player.redCards && player.redCards > 0 ? player.redCards : 0;
  const hasStats = player.goals > 0 || blueCardsCount > 0 || redCardsCount > 0;
  const goalLabel = player.goals > 0 ? `${player.goals} ${goalsWord(player.goals, locale)}` : '';

  return {
    hasStats,
    goalLabel,
    blueCardsCount,
    redCardsCount,
  };
}
