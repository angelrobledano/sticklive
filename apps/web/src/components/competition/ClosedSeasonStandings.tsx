import type { SeasonStandingRow } from '@/lib/api/types';
import { LocaleLink as Link } from '@/components/shared/LocaleLink';
import { TeamShield } from '@/components/shared/TeamShield';
import { clubName } from '@/lib/names';

const COPY: Record<string, { title: string; pos: string; team: string; played: string; won: string; drawn: string; lost: string; gf: string; ga: string; points: string; group: string }> = {
  es: { title: 'Clasificación final', pos: 'Pos', team: 'Equipo', played: 'PJ', won: 'G', drawn: 'E', lost: 'P', gf: 'GF', ga: 'GC', points: 'Pts', group: 'Grupo' },
  en: { title: 'Final standings', pos: 'Pos', team: 'Team', played: 'P', won: 'W', drawn: 'D', lost: 'L', gf: 'GF', ga: 'GA', points: 'Pts', group: 'Group' },
  pt: { title: 'Classificação final', pos: 'Pos', team: 'Equipa', played: 'J', won: 'V', drawn: 'E', lost: 'D', gf: 'GM', ga: 'GS', points: 'Pts', group: 'Grupo' },
  fr: { title: 'Classement final', pos: 'Pos', team: 'Équipe', played: 'J', won: 'G', drawn: 'N', lost: 'P', gf: 'BP', ga: 'BC', points: 'Pts', group: 'Groupe' },
  it: { title: 'Classifica finale', pos: 'Pos', team: 'Squadra', played: 'G', won: 'V', drawn: 'N', lost: 'P', gf: 'GF', ga: 'GS', points: 'Pti', group: 'Girone' },
};

export function ClosedSeasonStandings({ rows, locale }: { rows: SeasonStandingRow[]; locale: string }) {
  if (rows.length === 0) return null;
  const c = COPY[locale] ?? COPY['en']!;
  const groups = [...new Set(rows.map((r) => r.groupName).filter(Boolean))] as string[];

  return (
    <section className="card p-4" aria-labelledby="final-standings-title">
      <h2 id="final-standings-title" className="mb-3 text-base font-bold text-slate-900 dark:text-slate-50">{c.title}</h2>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[620px] text-xs">
          <thead>
            <tr className="border-b border-slate-200 text-[10px] uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:text-slate-400">
              <th className="px-1.5 py-2 text-right font-semibold">{c.pos}</th>
              <th className="px-1.5 py-2 text-left font-semibold">{c.team}</th>
              <th className="px-1.5 py-2 text-right font-semibold">{c.played}</th>
              <th className="px-1.5 py-2 text-right font-semibold">{c.won}</th>
              <th className="px-1.5 py-2 text-right font-semibold">{c.drawn}</th>
              <th className="px-1.5 py-2 text-right font-semibold">{c.lost}</th>
              <th className="px-1.5 py-2 text-right font-semibold">{c.gf}</th>
              <th className="px-1.5 py-2 text-right font-semibold">{c.ga}</th>
              <th className="px-1.5 py-2 text-right font-semibold">{c.points}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.groupName ?? ''}-${r.teamId}`} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
                <td className="px-1.5 py-2 text-right font-score tabular-nums text-slate-500 dark:text-slate-400">{r.position ?? '-'}</td>
                <td className="px-1.5 py-2">
                  <Link href={`/teams/${r.teamId}`} className="flex items-center gap-1.5 font-medium text-slate-800 hover:underline dark:text-slate-100">
                    <TeamShield teamId={r.teamId} teamName={r.teamName} size={18} className="shrink-0" />
                    <span className="truncate">{clubName(r.teamName)}</span>
                    {r.groupName && groups.length > 1 ? <span className="text-[10px] text-slate-400">({c.group} {r.groupName})</span> : null}
                  </Link>
                </td>
                <td className="px-1.5 py-2 text-right font-score tabular-nums">{r.played}</td>
                <td className="px-1.5 py-2 text-right font-score tabular-nums">{r.won}</td>
                <td className="px-1.5 py-2 text-right font-score tabular-nums">{r.drawn}</td>
                <td className="px-1.5 py-2 text-right font-score tabular-nums">{r.lost}</td>
                <td className="px-1.5 py-2 text-right font-score tabular-nums">{r.goalsFor}</td>
                <td className="px-1.5 py-2 text-right font-score tabular-nums">{r.goalsAgainst}</td>
                <td className="px-1.5 py-2 text-right font-score font-bold tabular-nums text-slate-900 dark:text-slate-50">{r.points}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
