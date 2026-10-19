import type { MatchPreview as MatchPreviewData } from '@/lib/content-summary';

const LABELS: Record<string, {
  title: string; position: string; points: string; form: string; h2h: string; emptyH2h: string;
}> = {
  es: { title: 'Previa del partido', position: 'Posición', points: 'Puntos', form: 'Forma', h2h: 'Enfrentamientos previos', emptyH2h: 'Sin enfrentamientos previos esta temporada.' },
  en: { title: 'Match preview', position: 'Position', points: 'Points', form: 'Form', h2h: 'Previous meetings', emptyH2h: 'No previous meetings this season.' },
  pt: { title: 'Antevisão do jogo', position: 'Posição', points: 'Pontos', form: 'Forma', h2h: 'Confrontos anteriores', emptyH2h: 'Sem confrontos anteriores esta temporada.' },
  fr: { title: 'Avant-match', position: 'Position', points: 'Points', form: 'Forme', h2h: 'Confrontations précédentes', emptyH2h: 'Aucune confrontation cette saison.' },
  it: { title: 'Anteprima partita', position: 'Posizione', points: 'Punti', form: 'Forma', h2h: 'Precedenti', emptyH2h: 'Nessun precedente in questa stagione.' },
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
