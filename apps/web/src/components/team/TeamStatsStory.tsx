'use client';

import { useMemo, useState } from 'react';
import { LocaleLink as Link } from '@/components/shared/LocaleLink';
import { useT } from '@/lib/i18n';
import type { TeamMatchSummary, TeamSeasonStats } from '@/lib/api/types';
import { teamStatsStory, type Record3 } from '@/lib/team-stats-story';
import type { TeamResult } from '@/lib/team-calendar';

const RESULT_BG: Record<TeamResult, string> = {
  W: 'bg-emerald-600', D: 'bg-slate-400 dark:bg-slate-500', L: 'bg-rink-passion',
};

function Chapter({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="card p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 font-score text-[11px] font-bold text-white dark:bg-slate-100 dark:text-slate-900">{n}</span>
        <h3 className="text-[11px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">{title}</h3>
      </div>
      {children}
    </section>
  );
}

/** Barra apilada V/E/D con las cifras dentro cuando caben. */
function RecordBar({ r, height = 'h-7' }: { r: Record3; height?: string }) {
  const { t } = useT();
  const total = r.w + r.d + r.l;
  if (total === 0) return <div className={`${height} rounded-lg bg-slate-100 dark:bg-slate-800`} />;
  const seg = (n: number, k: TeamResult) => n > 0 && (
    <div
      className={`flex items-center justify-center text-[11px] font-bold text-white ${RESULT_BG[k]}`}
      style={{ width: `${(n / total) * 100}%` }}
      title={`${n} ${t(`team_calendar.res_${k}_full`)}`}
    >
      {n / total >= 0.12 ? `${n} ${t(`team_calendar.res_${k}`)}` : ''}
    </div>
  );
  return (
    <div className={`flex ${height} gap-0.5 overflow-hidden rounded-lg`}>
      {seg(r.w, 'W')}{seg(r.d, 'D')}{seg(r.l, 'L')}
    </div>
  );
}

/** Anillo de acierto (SVG): marcados sobre lanzados. */
function Ring({ scored, total, label }: { scored: number; total: number; label: string }) {
  const pct = total > 0 ? scored / total : 0;
  const r = 30;
  const c = 2 * Math.PI * r;
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="relative h-20 w-20">
        <svg viewBox="0 0 72 72" className="h-20 w-20 -rotate-90">
          <circle cx="36" cy="36" r={r} fill="none" strokeWidth="8" className="stroke-slate-100 dark:stroke-slate-800" />
          {scored > 0 && (
            <circle cx="36" cy="36" r={r} fill="none" strokeWidth="8" strokeLinecap="round"
              strokeDasharray={`${c * pct} ${c}`} className={pct >= 0.5 ? 'stroke-emerald-600' : 'stroke-rink-passion'} />
          )}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-score text-lg font-bold tabular-nums text-slate-900 dark:text-slate-50">{total > 0 ? `${Math.round(pct * 100)}%` : '—'}</span>
        </div>
      </div>
      <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">{label}</p>
      <p className="font-score text-[11px] tabular-nums text-slate-500">{scored}/{total}</p>
    </div>
  );
}

export function TeamStatsStory({ stats, matches, teamId }: { stats: TeamSeasonStats; matches: TeamMatchSummary[]; teamId: string }) {
  const { t, locale } = useT();
  const [showAll, setShowAll] = useState(false);
  const story = useMemo(() => teamStatsStory(stats, matches, teamId, { locale }), [stats, matches, teamId, locale]);
  const num = new Intl.NumberFormat(locale, { maximumFractionDigits: 1, minimumFractionDigits: 1 });
  const maxPm = Math.max(story.scoring.forPerMatch, story.scoring.againstPerMatch, 1);
  const pctPts = (r: Record3) => {
    const p = r.w + r.d + r.l;
    return p > 0 ? Math.round(((r.w * 3 + r.d) / (p * 3)) * 100) : 0;
  };

  return (
    <div className="space-y-4">
      {/* Titular */}
      <section className="card overflow-hidden">
        <div className="bg-gradient-to-br from-rink-passion to-rose-900 px-5 py-6 text-white">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/70">{t('team_story.kicker')}</p>
          <h2 className="mt-1 text-2xl font-bold leading-tight">{story.headline.title}</h2>
          <p className="mt-1 text-sm text-white/80">{story.headline.sub}</p>
          {story.results.streak.length > 0 && (
            <div className="mt-4 flex gap-1.5">
              {story.results.streak.map((r, i) => (
                <span key={i} className={`inline-flex h-7 w-7 items-center justify-center rounded-lg text-xs font-bold ring-1 ring-white/30 ${
                  r === 'W' ? 'bg-emerald-500' : r === 'L' ? 'bg-black/30' : 'bg-white/25'
                }`}>{t(`team_calendar.res_${r}`)}</span>
              ))}
            </div>
          )}
        </div>
      </section>

      <Chapter n={1} title={t('team_story.results')}>
        <p className="mb-3 text-sm text-slate-700 dark:text-slate-200">{story.results.sentence}</p>
        <RecordBar r={story.results.all} />
        <div className="mt-4 space-y-2.5">
          {([['home', story.results.home], ['away', story.results.away]] as const).map(([k, r]) => (
            <div key={k} className="grid grid-cols-[4.5rem_1fr_auto] items-center gap-3">
              <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">{t(`team_calendar.${k}`)}</span>
              <RecordBar r={r} height="h-4" />
              <span className="whitespace-nowrap text-right font-score text-[11px] tabular-nums text-slate-500">{t('team_story.points_pct', { n: pctPts(r) })}</span>
            </div>
          ))}
        </div>
        {story.results.venue && (
          <p className="mt-3 border-l-2 border-rink-passion pl-3 text-sm font-medium text-slate-900 dark:text-slate-50">{story.results.venue}</p>
        )}
      </Chapter>

      <Chapter n={2} title={t('team_story.attack_defense')}>
        <div className="space-y-3">
          {([
            ['scored_pm', story.scoring.forPerMatch, 'bg-emerald-600'],
            ['conceded_pm', story.scoring.againstPerMatch, 'bg-rink-passion'],
          ] as const).map(([k, v, color]) => (
            <div key={k}>
              <div className="mb-1 flex items-baseline justify-between">
                <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">{t(`team_story.${k}`)}</span>
                <span className="font-score text-xl font-bold tabular-nums text-slate-900 dark:text-slate-50">{num.format(v)}</span>
              </div>
              <div className="h-3 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                <div className={`h-full rounded-full ${color}`} style={{ width: `${(v / maxPm) * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-sm text-slate-700 dark:text-slate-200">{story.scoring.sentence}</p>
        {story.scoring.biggestWin && (
          <Link href={`/matches/${story.scoring.biggestWin.matchId}`} className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-rink-passion hover:underline dark:text-rose-400">
            {story.scoring.biggestWin.text} →
          </Link>
        )}
      </Chapter>

      <Chapter n={3} title={t('team.discipline')}>
        <p className="mb-3 text-sm text-slate-700 dark:text-slate-200">{story.discipline.sentence}</p>
        <div className="grid grid-cols-4 gap-2 text-center">
          {([
            [num.format(story.discipline.foulsPerMatch), t('team_story.fouls_pm'), ''],
            [stats.blueCards, t('hockey_stats.blue_cards'), 'border-t-4 border-blue-500'],
            [stats.redCards, t('hockey_stats.red_cards'), 'border-t-4 border-red-600'],
            [stats.timeouts, t('hockey_stats.time_outs'), ''],
          ] as const).map(([v, l, extra]) => (
            <div key={l} className={`rounded-lg bg-slate-50 px-1 py-2 dark:bg-slate-800/60 ${extra}`}>
              <p className="font-score text-lg font-bold tabular-nums text-slate-900 dark:text-slate-50">{v}</p>
              <p className="text-[11px] leading-tight text-slate-500 dark:text-slate-400">{l}</p>
            </div>
          ))}
        </div>
      </Chapter>

      {(stats.penalties.total > 0 || stats.directFouls.total > 0) && (
        <Chapter n={4} title={t('team.set_pieces')}>
          {story.setPieces.sentence && <p className="mb-3 text-sm text-slate-700 dark:text-slate-200">{story.setPieces.sentence}</p>}
          <div className="flex justify-around">
            <Ring scored={stats.penalties.scored} total={stats.penalties.total} label={t('team.penalties')} />
            <Ring scored={stats.directFouls.scored} total={stats.directFouls.total} label={t('team.direct_fouls')} />
          </div>
        </Chapter>
      )}

      {/* Las cifras en bruto siguen disponibles para quien las busque. */}
      <div className="text-center">
        <button type="button" onClick={() => setShowAll((v) => !v)} aria-expanded={showAll} className="text-sm font-semibold text-slate-500 hover:text-rink-passion">
          {t('team_story.more')} {showAll ? '▴' : '▾'}
        </button>
      </div>
      {showAll && (
        <div className="card grid grid-cols-3 gap-2 p-4 text-center sm:grid-cols-6">
          {([
            [stats.played, t('team.played')], [stats.won, t('team.won')], [stats.drawn, t('team.drawn')], [stats.lost, t('team.lost')],
            [stats.goalsFor, t('team.goals_for')], [stats.goalsAgainst, t('team.goals_against')], [stats.assists, t('hockey_stats.assists')],
            [stats.teamFouls, t('hockey_stats.team_fouls')],
          ] as const).map(([v, l]) => (
            <div key={l} className="rounded-lg bg-slate-50 px-1 py-2 dark:bg-slate-800/60">
              <p className="font-score text-base font-bold tabular-nums text-slate-900 dark:text-slate-50">{v}</p>
              <p className="text-[11px] leading-tight text-slate-500 dark:text-slate-400">{l}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
