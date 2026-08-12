'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useT } from '@/lib/i18n';
import type { SeasonLeader, SeasonStats } from '@/lib/api/client';
import { TeamShield } from '@/components/shared/TeamShield';
import { TeamName as AdaptiveTeamName } from '@/components/shared/TeamName';
import { PlayerAvatar } from '@/components/shared/PlayerAvatar';
import { clubName } from '@/lib/names';
import { toLeaderName } from './format';

const LEADERBOARD_PREVIEW = 5;

function LeaderBoard({ title, leaders, valueLabel, extraLabel }: {
  title: string;
  leaders: SeasonLeader[];
  valueLabel: string;
  extraLabel?: string;
}) {
  const { t } = useT();
  const [expanded, setExpanded] = useState(false);
  if (leaders.length === 0) return null;

  const visible = expanded ? leaders : leaders.slice(0, LEADERBOARD_PREVIEW);
  const hiddenCount = leaders.length - LEADERBOARD_PREVIEW;

  return (
    <div className="card overflow-hidden">
      <div className="px-4 py-2 bg-slate-50 dark:bg-slate-800/40 border-b border-slate-100 dark:border-slate-800
                      flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">{title}</span>
        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          {valueLabel}{extraLabel ? ` / ${extraLabel}` : ''}
        </span>
      </div>
      <div className="divide-y divide-slate-100 dark:divide-slate-800/60">
        {visible.map((l, idx) => (
          <div key={`${l.playerId ?? l.playerName}-${idx}`} className="flex items-center gap-2.5 px-3 py-2">
            <span className="w-5 text-xs font-semibold text-slate-500 dark:text-slate-400 tabular-nums text-center">{idx + 1}</span>
            <PlayerAvatar
              photoUrl={l.photoUrl}
              name={toLeaderName(l.playerName)}
              className="w-8 h-8 rounded-full shrink-0"
            />
            <div className="flex-1 min-w-0">
              {l.playerId ? (
                <Link href={`/players/${l.playerId}`}
                      className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate hover:text-rink-passion hover:underline block">
                  {toLeaderName(l.playerName)}
                </Link>
              ) : (
                <span className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate block">{toLeaderName(l.playerName)}</span>
              )}
              <span className="text-[10px] text-slate-500 dark:text-slate-400 truncate block">{clubName(l.teamName ?? l.teamShort ?? '')}</span>
            </div>
            <span className="text-sm font-bold tabular-nums text-slate-900 dark:text-slate-50">{l.value}</span>
            {extraLabel && (
              <span className="w-6 text-xs text-slate-500 dark:text-slate-400 tabular-nums text-right">{l.extra}</span>
            )}
          </div>
        ))}
      </div>

      {hiddenCount > 0 && (
        <button
          onClick={() => setExpanded((e) => !e)}
          className="w-full py-2.5 min-h-[44px] text-xs font-semibold text-rink-passion
                     border-t border-slate-100 dark:border-slate-800
                     hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors"
        >
          {expanded ? t('common.show_less') : t('common.show_more', { n: hiddenCount })}
        </button>
      )}
    </div>
  );
}

export function StatsLeadersTab({ stats }: { stats: SeasonStats }) {
  const { t } = useT();
  const empty = stats.topScorers.length === 0 && stats.topAssists.length === 0 && stats.topCards.length === 0;
  if (empty) {
    return (
      <div className="card p-8 text-center opacity-60">
        <p className="text-sm text-slate-400 dark:text-slate-600">{t('leaders.no_data')}</p>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <LeaderBoard title={t('hockey_stats.top_scorers')} leaders={stats.topScorers} valueLabel={t('leaders.goals_short')} extraLabel={t('leaders.assists_short')} />
      <LeaderBoard title={t('hockey_stats.top_assisters')} leaders={stats.topAssists} valueLabel={t('hockey_stats.assists')} extraLabel={t('leaders.goals_short')} />
      <LeaderBoard title={t('hockey_stats.cards_leaderboard')} leaders={stats.topCards} valueLabel={t('leaders.blues_short')} extraLabel={t('leaders.reds_short')} />

      {/* Eficiencia a bola parada por equipo (la fuente no identifica al
          lanzador de las FD falladas, así que por jugador sería engañoso) */}
      {(stats.setPieces?.length ?? 0) > 0 && (
        <div className="card overflow-hidden">
          <div className="px-4 py-2 bg-slate-50 dark:bg-slate-800/40 border-b border-slate-100 dark:border-slate-800
                          flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
              {t('hockey_stats.efficiency')}
            </span>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              {t('leaders.directs_penalties')}
            </span>
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-800/60">
            {stats.setPieces!.map((tm) => (
              <div key={tm.teamId}
                   className="grid grid-cols-[1fr_84px_84px] items-center gap-2 px-3 py-2">
                <div className="flex items-center gap-2 min-w-0">
                  <TeamShield teamId={tm.teamId} teamName={tm.teamShort ?? tm.teamName ?? ''} size={20} />
                  <Link href={`/teams/${tm.teamId}`}
                        className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate hover:text-rink-passion hover:underline">
                    <AdaptiveTeamName name={tm.teamName ?? ''} shortName={tm.teamShort} />
                  </Link>
                </div>
                {[tm.directFouls, tm.penalties].map((m, i) => (
                  <div key={i} className="grid grid-cols-[1fr_auto] items-baseline gap-x-1.5 text-right">
                    <span className="text-xs font-normal tabular-nums text-slate-600 dark:text-slate-300">
                      {m.total > 0 ? `${m.scored}/${m.total}` : '—'}
                    </span>
                    <span className={`w-9 text-xs font-bold tabular-nums ${
                      m.pct !== null && m.pct >= 50
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : 'text-slate-700 dark:text-slate-200'
                    }`}>
                      {m.pct !== null ? `${m.pct}%` : ''}
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
