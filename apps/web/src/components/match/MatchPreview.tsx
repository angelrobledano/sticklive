import type { MatchPreview as MatchPreviewData } from '@/lib/content-summary';
import { LocaleLink as Link } from '@/components/shared/LocaleLink';

const LABELS: Record<string, {
  title: string; position: string; points: string; form: string; h2h: string; emptyH2h: string; lastFive: string;
}> = {
  es: { title: 'Previa del partido', position: 'Posición', points: 'Puntos', form: 'Forma', h2h: 'Enfrentamientos previos', emptyH2h: 'Sin enfrentamientos previos esta temporada.', lastFive: 'Últimos 5' },
  en: { title: 'Match preview', position: 'Position', points: 'Points', form: 'Form', h2h: 'Previous meetings', emptyH2h: 'No previous meetings this season.', lastFive: 'Last 5' },
  pt: { title: 'Antevisão do jogo', position: 'Posição', points: 'Pontos', form: 'Forma', h2h: 'Confrontos anteriores', emptyH2h: 'Sem confrontos anteriores esta temporada.', lastFive: 'Últimos 5' },
  fr: { title: 'Avant-match', position: 'Position', points: 'Points', form: 'Forme', h2h: 'Confrontations précédentes', emptyH2h: 'Aucune confrontation cette saison.', lastFive: '5 derniers' },
  it: { title: 'Anteprima partita', position: 'Posizione', points: 'Punti', form: 'Forma', h2h: 'Precedenti', emptyH2h: 'Nessun precedente in questa stagione.', lastFive: 'Ultime 5' },
};

function FormDots({ form }: { form: string[] }) {
  return (
    <div className="flex gap-1" aria-label="W/D/L">
      {form.map((r, i) => (
        <span
          key={`${r}-${i}`}
          className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-bold text-white ${
            r === 'W' ? 'bg-emerald-600' : r === 'L' ? 'bg-red-600' : 'bg-slate-400'
          }`}
        >
          {r}
        </span>
      ))}
    </div>
  );
}

/**
 * Previa server-rendered de un partido próximo. Solo pinta datos reales:
 * posición, puntos, forma y H2H de la temporada cargada. Si no hay ninguno,
 * devuelve null y la ficha sigue como antes.
 */
export function MatchPreview({ data, locale }: { data: MatchPreviewData; locale: string }) {
  const copy = LABELS[locale] ?? LABELS['en']!;
  const hasStanding = data.home.position !== null || data.away.position !== null
    || data.home.form.length > 0 || data.away.form.length > 0;
  if (!hasStanding && data.headToHead.length === 0) return null;

  const dateFmt = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' });

  return (
    <section className="card p-4 space-y-4" aria-labelledby="match-preview-title">
      <h2 id="match-preview-title" className="text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
        {copy.title}
      </h2>

      {hasStanding && (
        <div className="grid grid-cols-2 gap-3">
          {[data.home, data.away].map((team) => (
            <div key={team.teamId} className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800/60">
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-50">{team.teamName}</p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                {team.position !== null ? `#${team.position}` : '—'}
                {team.points !== null ? ` · ${team.points} ${copy.points.toLowerCase()}` : ''}
              </p>
              {team.form.length > 0 && (
                <div className="mt-2">
                  <p className="mb-1 text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">{copy.form}</p>
                  <FormDots form={team.form} />
                </div>
              )}
              {team.recent.length > 0 && (
                <div className="mt-3 border-t border-slate-200 pt-2 dark:border-slate-700">
                  <p className="mb-1 text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">{copy.lastFive}</p>
                  <ul className="space-y-1">
                    {team.recent.map((r) => (
                      <li key={r.id}>
                        <Link href={`/matches/${r.id}`} className="flex items-center justify-between gap-1 text-[11px] hover:underline">
                          <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${r.result === 'W' ? 'bg-emerald-600' : r.result === 'L' ? 'bg-red-600' : 'bg-slate-400'}`} />
                          <span className="min-w-0 flex-1 truncate text-slate-600 dark:text-slate-300">{r.isHome ? 'vs' : '@'} {r.opponentName}</span>
                          <span className="font-score shrink-0 tabular-nums text-slate-700 dark:text-slate-200">{r.goalsFor}-{r.goalsAgainst}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div>
        <h3 className="mb-2 text-xs font-semibold text-slate-700 dark:text-slate-300">{copy.h2h}</h3>
        {data.headToHead.length === 0 ? (
          <p className="text-xs text-slate-500 dark:text-slate-400">{copy.emptyH2h}</p>
        ) : (
          <ul className="space-y-1.5">
            {data.headToHead.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-2 text-xs text-slate-600 dark:text-slate-300">
                <span className="truncate">{m.homeName} – {m.awayName}</span>
                <span className="shrink-0 font-score font-semibold tabular-nums">
                  {m.homeScore ?? '—'}–{m.awayScore ?? '—'}
                </span>
                {m.date && <span className="shrink-0 text-slate-400">{dateFmt.format(new Date(m.date))}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
