'use client';

import { LocaleLink as Link } from '@/components/shared/LocaleLink';
import type { TeamSummary } from '@/lib/api/client';
import { useT } from '@/lib/i18n';
import { TrophyIcon } from '@/components/match/icons';
import { TeamShield } from '@/components/shared/TeamShield';

/**
 * Campeón del torneo, colgado bajo la final del cuadro (eliminatorias y Final
 * Four). Solo se monta cuando la final ya tiene ganador.
 */
export function ChampionBlock({ team, variant = 'stack' }: { team: TeamSummary; variant?: 'stack' | 'row' }) {
  const { t } = useT();
  if (variant === 'row') {
    // Franja compacta encima del cuadro (móvil: la final queda a la derecha,
    // fuera de pantalla, y el campeón es lo primero que se busca).
    return (
      <Link
        href={`/teams/${team.id}`}
        data-champion-row={team.id}
        className="flex items-center gap-3 rounded-xl border border-rink-passion/40 bg-rink-passion/5 px-3 py-2.5 dark:bg-rink-passion/10"
      >
        <span className="inline-flex items-center gap-1 rounded-full bg-rink-passion px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-white">
          <TrophyIcon className="h-3.5 w-3.5" />
          {t('playoffs.champion')}
        </span>
        <TeamShield teamId={team.id} teamName={team.shortName ?? team.name} size={28} />
        <span className="min-w-0 flex-1 truncate text-[15px] font-bold text-slate-900 dark:text-slate-50">{team.name}</span>
      </Link>
    );
  }
  return (
    <Link
      href={`/teams/${team.id}`}
      data-champion={team.id}
      className="flex w-full flex-col items-center gap-1.5 rounded-xl border border-rink-passion/40 bg-rink-passion/5 px-3 py-3 text-center
                 transition-opacity hover:opacity-90 dark:bg-rink-passion/10"
    >
      <span className="inline-flex items-center gap-1.5 rounded-full bg-rink-passion px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-white">
        <TrophyIcon className="h-3.5 w-3.5" />
        {t('playoffs.champion')}
      </span>
      <TeamShield teamId={team.id} teamName={team.shortName ?? team.name} size={40} />
      <span className="max-w-full truncate text-base font-bold text-slate-900 dark:text-slate-50">{team.name}</span>
    </Link>
  );
}
