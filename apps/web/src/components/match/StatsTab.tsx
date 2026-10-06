'use client';

import { useT } from '@/lib/i18n';
import type { MatchDetail } from '@/lib/api/client';
import { AdBanner } from '@/components/shared/AdBanner';

function StatRow({ label, home, away, max }: {
  label: string; home: number; away: number; max: number;
}) {
  const safeMax = max || 1;
  const homePct = Math.round((home / safeMax) * 100);
  const awayPct = Math.round((away / safeMax) * 100);

  return (
    <div className="space-y-1">
      {/* Título de la métrica ENCIMA, centrado y legible — no camuflado entre barras */}
      <p className="text-xs font-semibold text-slate-700 dark:text-slate-300 text-center">{label}</p>
      <div className="flex items-center gap-2">
        <span className="w-7 text-sm font-bold tabular-nums text-slate-900 dark:text-slate-50 text-right">{home}</span>
        {/* Dos barras enfrentadas desde el centro; ambos lados con color activo */}
        <div className="flex flex-1 h-2 items-center gap-px">
          <div className="flex-1 flex justify-end rounded-l-full overflow-hidden bg-slate-100 dark:bg-slate-800 h-full">
            <div className="bg-rink-passion h-full rounded-l-full transition-all duration-500" style={{ width: `${homePct}%` }} />
          </div>
          <div className="flex-1 rounded-r-full overflow-hidden bg-slate-100 dark:bg-slate-800 h-full">
            <div className="bg-slate-600 dark:bg-slate-300 h-full rounded-r-full transition-all duration-500" style={{ width: `${awayPct}%` }} />
          </div>
        </div>
        <span className="w-7 text-sm font-bold tabular-nums text-slate-900 dark:text-slate-50">{away}</span>
      </div>
    </div>
  );
}

export function StatsTab({ data }: { data: MatchDetail }) {
  const { t } = useT();
  const { stats, match } = data;
  const totalPen = stats.homePenalties.total + stats.awayPenalties.total;

  // ¿Hay algo que mostrar? Antes el corte miraba SOLO las faltas: un partido en
  // directo con goles pero sin faltas caía aquí y ocultaba el marcador de stats
  // (#283). Ahora cualquier métrica con valor mantiene la tabla visible.
  const hasAnyStats =
    stats.homeFouls > 0 || stats.awayFouls > 0 ||
    (stats.homeGoals ?? 0) > 0 || (stats.awayGoals ?? 0) > 0 ||
    (stats.homeBlueCards ?? 0) > 0 || (stats.awayBlueCards ?? 0) > 0 ||
    (stats.homeRedCards ?? 0) > 0 || (stats.awayRedCards ?? 0) > 0 ||
    (stats.homeTimeouts ?? 0) > 0 || (stats.awayTimeouts ?? 0) > 0 ||
    ((stats.homeDirectFouls?.total ?? 0) + (stats.awayDirectFouls?.total ?? 0)) > 0 ||
    totalPen > 0;

  if (!hasAnyStats) {
    if (match.status === 'scheduled') {
      return (
        <div className="card p-8 text-center opacity-60">
          <p className="text-sm text-slate-500 dark:text-slate-400">{t('match_detail.stats_pending')}</p>
        </div>
      );
    }
    return (
      <div className="card p-8 flex justify-center">
        <div className="inline-flex items-center gap-2.5 px-4 py-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4 text-amber-500 shrink-0">
            <path d="M10.3 3.7L2.3 18a2 2 0 0 0 1.7 3h16a2 2 0 0 0 1.7-3L13.7 3.7a2 2 0 0 0-3.4 0z" />
            <path d="M12 9v4M12 17h.01" strokeLinecap="round" />
          </svg>
          <span className="text-sm font-medium text-amber-700 dark:text-amber-400">
            Estadisticas de faltas y bola parada en proceso de computo.
          </span>
        </div>
      </div>
    );
  }

  const homePenEfic = stats.homePenalties.total > 0
    ? Math.round((stats.homePenalties.scored / stats.homePenalties.total) * 100) : 0;
  const awayPenEfic = stats.awayPenalties.total > 0
    ? Math.round((stats.awayPenalties.scored / stats.awayPenalties.total) * 100) : 0;

  return (
    <>
    <div className="card p-5 space-y-5">
      {/* Cabecera de columnas */}
      <div className="flex justify-between text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-widest">
        <span>{match.homeTeam?.shortName ?? 'Local'}</span>
        <span>{match.awayTeam?.shortName ?? 'Visitante'}</span>
      </div>

      <StatRow label={t('hockey_stats.goals')} home={stats.homeGoals ?? 0} away={stats.awayGoals ?? 0} max={Math.max(stats.homeGoals ?? 0, stats.awayGoals ?? 0)} />

      {((stats.homeAssists ?? 0) > 0 || (stats.awayAssists ?? 0) > 0) && (
        <StatRow label={t('hockey_stats.assists')} home={stats.homeAssists ?? 0} away={stats.awayAssists ?? 0} max={Math.max(stats.homeAssists ?? 0, stats.awayAssists ?? 0)} />
      )}

      <div className="h-px bg-slate-100 dark:bg-slate-800" />

      <StatRow label={t('hockey_stats.team_fouls')} home={stats.homeFouls} away={stats.awayFouls} max={Math.max(stats.homeFouls, stats.awayFouls)} />

      <StatRow label={t('hockey_stats.blue_cards')} home={stats.homeBlueCards ?? 0} away={stats.awayBlueCards ?? 0} max={Math.max(stats.homeBlueCards ?? 0, stats.awayBlueCards ?? 0)} />

      {((stats.homeRedCards ?? 0) > 0 || (stats.awayRedCards ?? 0) > 0) && (
        <StatRow label={t('hockey_stats.red_cards')} home={stats.homeRedCards ?? 0} away={stats.awayRedCards ?? 0} max={Math.max(stats.homeRedCards ?? 0, stats.awayRedCards ?? 0)} />
      )}

      <StatRow label={t('hockey_stats.time_outs')} home={stats.homeTimeouts ?? 0} away={stats.awayTimeouts ?? 0} max={Math.max(stats.homeTimeouts ?? 0, stats.awayTimeouts ?? 0)} />

      {(((stats.homeDirectFouls?.total ?? 0) + (stats.awayDirectFouls?.total ?? 0)) > 0) && (
        <>
          <div className="h-px bg-slate-100 dark:bg-slate-800" />
          <StatRow
            label={t('hockey_stats.direct_fouls_shot')}
            home={stats.homeDirectFouls?.total ?? 0}
            away={stats.awayDirectFouls?.total ?? 0}
            max={Math.max(stats.homeDirectFouls?.total ?? 0, stats.awayDirectFouls?.total ?? 0)}
          />
          <StatRow
            label={t('hockey_stats.direct_fouls_scored')}
            home={stats.homeDirectFouls?.scored ?? 0}
            away={stats.awayDirectFouls?.scored ?? 0}
            max={Math.max(stats.homeDirectFouls?.total ?? 0, stats.awayDirectFouls?.total ?? 0, 1)}
          />
          <div className="flex justify-between items-baseline pt-1 border-t border-slate-100 dark:border-slate-800">
            <span className="text-xs font-semibold text-slate-600 dark:text-slate-400">
              {(stats.homeDirectFouls?.total ?? 0) > 0 ? Math.round(((stats.homeDirectFouls?.scored ?? 0) / stats.homeDirectFouls!.total) * 100) : 0}%
            </span>
            <span className="text-[10px] text-slate-500 dark:text-slate-400 flex-1 text-center px-3">{t('match_detail.direct_fouls_efficiency')}</span>
            <span className="text-xs font-semibold text-slate-600 dark:text-slate-400">
              {(stats.awayDirectFouls?.total ?? 0) > 0 ? Math.round(((stats.awayDirectFouls?.scored ?? 0) / stats.awayDirectFouls!.total) * 100) : 0}%
            </span>
          </div>
        </>
      )}

      {totalPen > 0 && (
        <>
          <div className="h-px bg-slate-100 dark:bg-slate-800" />
          <StatRow label={t('hockey_stats.penalties_shot')} home={stats.homePenalties.total} away={stats.awayPenalties.total} max={Math.max(stats.homePenalties.total, stats.awayPenalties.total)} />
          <StatRow label={t('hockey_stats.penalties_scored')} home={stats.homePenalties.scored} away={stats.awayPenalties.scored} max={Math.max(stats.homePenalties.total, stats.awayPenalties.total, 1)} />
          <div className="flex justify-between items-baseline pt-1 border-t border-slate-100 dark:border-slate-800">
            <span className="text-xs font-semibold text-slate-600 dark:text-slate-400">{homePenEfic}%</span>
            <span className="text-[10px] text-slate-500 dark:text-slate-400 flex-1 text-center px-3">{t('match_detail.penalties_efficiency')}</span>
            <span className="text-xs font-semibold text-slate-600 dark:text-slate-400">{awayPenEfic}%</span>
          </div>
        </>
      )}
    </div>

    {/* Banner de monetización al final de las estadísticas
        Solo visible para usuarios Free — nulo para Premium */}
    <AdBanner zone="match-stats" className="mt-2 rounded-xl overflow-hidden" />
  </>
  );
}
