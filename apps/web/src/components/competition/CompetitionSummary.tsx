import type { CompetitionSummary as CompetitionSummaryData } from '@/lib/content-summary';

const LABELS: Record<string, {
  title: string; leader: string; next: string; scorer: string; matchday: string; goals: string;
}> = {
  es: { title: 'Resumen de la competición', leader: 'Líder', next: 'Próximo partido', scorer: 'Máximo goleador', matchday: 'Jornada', goals: 'goles' },
  en: { title: 'Competition summary', leader: 'Leader', next: 'Next match', scorer: 'Top scorer', matchday: 'Matchday', goals: 'goals' },
  pt: { title: 'Resumo da competição', leader: 'Líder', next: 'Próximo jogo', scorer: 'Melhor marcador', matchday: 'Jornada', goals: 'golos' },
  fr: { title: 'Résumé de la compétition', leader: 'Leader', next: 'Prochain match', scorer: 'Meilleur buteur', matchday: 'Journée', goals: 'buts' },
  it: { title: 'Riepilogo competizione', leader: 'Leader', next: 'Prossima partita', scorer: 'Capocannoniere', matchday: 'Giornata', goals: 'gol' },
};

/** Resumen server-rendered de competición (F4-2), solo con datos reales. */
export function CompetitionSummary({ data, locale }: { data: CompetitionSummaryData; locale: string }) {
  const copy = LABELS[locale] ?? LABELS['en']!;
  if (!data.leader && !data.nextMatch && !data.topScorer) return null;

  const dateFmt = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' });
  const round = data.nextMatch?.round;

  return (
    <section className="card p-4 space-y-2" aria-labelledby="competition-summary-title">
      <h2 id="competition-summary-title" className="text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
        {copy.title}
      </h2>
      <ul className="space-y-1.5 text-sm text-slate-700 dark:text-slate-300">
        {data.leader && (
          <li>
            <span className="font-semibold">{copy.leader}:</span>{' '}
            {data.leader.teamName} · {data.leader.points} pts
          </li>
        )}
        {data.nextMatch && (
          <li>
            <span className="font-semibold">{copy.next}:</span>{' '}
            {data.nextMatch.homeName} – {data.nextMatch.awayName}
            {data.nextMatch.date ? ` · ${dateFmt.format(new Date(data.nextMatch.date))}` : ''}
            {round ? ` · ${round}` : ''}
          </li>
        )}
        {data.topScorer && (
          <li>
            <span className="font-semibold">{copy.scorer}:</span>{' '}
            {data.topScorer.playerName}
            {data.topScorer.teamName ? ` (${data.topScorer.teamName})` : ''} · {data.topScorer.value} {copy.goals}
          </li>
        )}
      </ul>
    </section>
  );
}
