import type { HeadToHeadMatch } from '@/lib/content-summary';
import { LocaleLink as Link } from '@/components/shared/LocaleLink';
import { clubName } from '@/lib/names';

const COPY: Record<string, { title: string; date: string }> = {
  es: { title: 'Último enfrentamiento', date: '' },
  en: { title: 'Previous meeting', date: '' },
  pt: { title: 'Último confronto', date: '' },
  fr: { title: 'Dernière confrontation', date: '' },
  it: { title: 'Ultimo precedente', date: '' },
};

export function PreviousMeeting({ match, locale }: { match: HeadToHeadMatch | null; locale: string }) {
  if (!match) return null;
  const c = COPY[locale] ?? COPY['en']!;
  const dateFmt = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' });
  return (
    <section className="card p-4" aria-labelledby="previous-meeting-title">
      <h2 id="previous-meeting-title" className="text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
        {c.title}
      </h2>
      <Link href={`/matches/${match.id}`} className="mt-2 flex items-center justify-between gap-3 text-sm hover:underline">
        <span className="min-w-0 truncate text-slate-700 dark:text-slate-200">{clubName(match.homeName)} - {clubName(match.awayName)}</span>
        <span className="shrink-0 font-score font-semibold tabular-nums text-slate-900 dark:text-slate-50">{match.homeScore ?? '-'}-{match.awayScore ?? '-'}</span>
        {match.date && <span className="shrink-0 text-xs text-slate-400">{dateFmt.format(new Date(match.date))}</span>}
      </Link>
    </section>
  );
}
