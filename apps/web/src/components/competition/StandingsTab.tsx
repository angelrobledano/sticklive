'use client';

import Link from 'next/link';
import { useT } from '@/lib/i18n';
import type { SeasonStandingRow } from '@/lib/api/client';
import { TeamShield } from '@/components/shared/TeamShield';
import { FavoriteStar } from '@/components/shared/FavoriteStar';
import { TeamName as AdaptiveTeamName } from '@/components/shared/TeamName';

const PLAYOFF_SPOTS = 8;
const RELEGATION_SPOTS = 2; // últimos 2 descienden en OK Liga

export function StandingsTab({ standings }: { standings: SeasonStandingRow[] }) {
  const { t } = useT();
  if (standings.length === 0) {
    return (
      <div className="card p-8 text-center opacity-60">
        <p className="text-sm text-slate-400 dark:text-slate-600">{t('standings.no_data')}</p>
      </div>
    );
  }

  return (
    <div className="card overflow-hidden">
      {/* Cabecera de la tabla — columnas de stats más estrechas para dar
          espacio al nombre del equipo y evitar truncados */}
      {/* border-l transparente: alinea la cabecera con las filas (que llevan
          barra lateral de 2px de zona) — sin él hay un micro-desplazamiento */}
      <div className="grid grid-cols-[24px_1fr_repeat(8,26px)] gap-x-1 px-3 py-1.5 border-l-2 border-l-transparent
                      bg-slate-50 dark:bg-slate-800/60 border-b border-slate-100 dark:border-slate-800">
        <span className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider text-center">#</span>
        <span className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">{t('standings.team')}</span>
        {[t('standings.cols.pts'), t('standings.cols.played'), t('standings.cols.won'), t('standings.cols.drawn'),
          t('standings.cols.lost'), t('standings.cols.gf'), t('standings.cols.ga'), t('standings.cols.gd')].map((h) => (
          <span key={h} className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider text-center">{h}</span>
        ))}
      </div>

      {/* Filas */}
      <div className="divide-y divide-slate-100 dark:divide-slate-800/60">
        {standings.map((row, idx) => {
          const pos = row.position ?? idx + 1;
          const total = standings.length;
          const isPlayoff    = pos <= PLAYOFF_SPOTS;
          const isRelegation = total > 0 && pos > total - RELEGATION_SPOTS;
          const isLast       = idx === total - 1;
          const showPlayoffBorder    = isPlayoff    && pos === PLAYOFF_SPOTS    && !isLast;
          const showRelegationBorder = isRelegation && pos === total - RELEGATION_SPOTS + 1;

          return (
            <div
              key={row.id}
              className={`grid grid-cols-[24px_1fr_repeat(8,26px)] gap-x-1 px-3 py-2 items-center border-l-2
                ${showPlayoffBorder    ? 'border-b-2 border-dashed border-b-rink-passion/30 dark:border-b-red-400/40' : ''}
                ${showRelegationBorder ? 'border-t-2 border-dashed border-t-orange-400/50 dark:border-t-orange-400/40' : ''}
                ${isPlayoff            ? 'border-l-rink-passion dark:border-l-red-400 bg-rink-passion/[0.03] dark:bg-red-400/[0.06]' :
                  isRelegation         ? 'border-l-orange-500 dark:border-l-orange-400 bg-orange-50/40 dark:bg-orange-400/[0.06]' :
                                         'border-l-transparent'}
              `}
            >
              {/* Posición — gris medio uniforme: la barra lateral ya marca la
                  zona, y así el nombre y los puntos son lo que destaca */}
              <span className="text-xs font-semibold text-center tabular-nums text-slate-500 dark:text-slate-400">
                {pos}
              </span>

              {/* Equipo */}
              <Link
                href={`/teams/${row.teamId}`}
                className="flex items-center gap-2 min-w-0 hover:opacity-75 transition-opacity"
              >
                <TeamShield teamId={row.teamId} teamName={row.teamName} size={20} />
                {/* Estrella solo en escritorio: en móvil la tabla queda 100%
                    limpia y se sigue desde el perfil del equipo o desde
                    Gestionar favoritos */}
                <FavoriteStar
                  id={row.teamId}
                  kind="team"
                  name={row.teamShortName ?? row.teamName}
                  className="shrink-0 !w-10 !h-10 !-m-2.5 !hidden md:!inline-flex"
                />
                <AdaptiveTeamName
                  name={row.teamName}
                  shortName={row.teamShortName}
                  className="flex-1 min-w-0 text-xs font-semibold text-slate-800 dark:text-slate-200 truncate"
                />
              </Link>

              {/* PT con penalización */}
              <div className="flex items-baseline justify-center gap-0.5">
                <span className="text-xs font-bold tabular-nums text-slate-900 dark:text-slate-50">
                  {row.points}
                </span>
                {row.penalizationPoints < 0 && (
                  <span className="text-[8px] font-bold text-red-500 tabular-nums leading-none">
                    {row.penalizationPoints}
                  </span>
                )}
              </div>

              {/* PJ, PG, PE, PP, GF, GC, DG */}
              {[row.played, row.won, row.drawn, row.lost, row.goalsFor, row.goalsAgainst].map((v, i) => (
                <span key={i} className="text-[11px] text-slate-500 dark:text-slate-400 text-center tabular-nums">{v}</span>
              ))}
              <span className={`text-xs font-semibold text-center tabular-nums ${
                row.goalDiff > 0 ? 'text-emerald-600 dark:text-emerald-400' :
                row.goalDiff < 0 ? 'text-red-500' : 'text-slate-400'
              }`}>
                {row.goalDiff > 0 ? `+${row.goalDiff}` : row.goalDiff}
              </span>
            </div>
          );
        })}
      </div>

      {/* Leyenda — compacta y discreta: dots de color, gris medio neutro */}
      <div className="px-3 py-1.5 flex flex-wrap gap-x-3 gap-y-0.5 border-t border-slate-100 dark:border-slate-800">
        {/* Los dots replican EXACTAMENTE los colores de las barras laterales */}
        <div className="flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-rink-passion dark:bg-red-400 shrink-0" />
          <span className="text-[10px] text-slate-400 dark:text-slate-500">{t('standings.playoffs_zone')}</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-orange-500 dark:bg-orange-400 shrink-0" />
          <span className="text-[10px] text-slate-400 dark:text-slate-500">{t('standings.relegation_zone')}</span>
        </div>
      </div>
    </div>
  );
}
