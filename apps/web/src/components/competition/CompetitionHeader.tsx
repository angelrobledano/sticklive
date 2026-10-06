'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useT } from '@/lib/i18n';
import type { SeasonOverview, CompetitionSeason } from '@/lib/api/client';
import { ShareButton } from '@/components/shared/ShareButton';
import { FavoriteStar } from '@/components/shared/FavoriteStar';
import { ManageNotificationsButton } from '@/components/shared/ManageNotificationsButton';
import { fedLabelFromSeason } from './format';
import { competitionName } from '@/lib/names';
import { SeasonNoteLine } from './SeasonNote';

export function CompetitionHeader({ data, seasons, competitionId }: {
  data: SeasonOverview;
  seasons?: CompetitionSeason[];
  competitionId?: string;
}) {
  const { season } = data;
  const router = useRouter();
  const { t, locale } = useT();
  const selectRef = useRef<HTMLSelectElement>(null);
  // Al cambiar de temporada navegamos (contexto esperado en un filtro), pero
  // devolvemos el foco al selector para no perderlo tras el re-render (#364).
  const wasFocused = useRef(false);
  useEffect(() => {
    if (wasFocused.current) selectRef.current?.focus();
  }, [season.id]);
  const hasHistory = !!competitionId && (seasons?.length ?? 0) > 1;
  const fedLabel = fedLabelFromSeason(season, locale);
  const compName = competitionName(season.competitionName, season.competitionNameI18n, locale);

  return (
    <div className="card px-4 py-3.5 flex items-center gap-3.5">
      <div className="w-10 h-10 rounded-xl bg-rink-passion flex items-center justify-center shrink-0">
        <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2} className="w-5 h-5">
          <path d="M8 3h8v10a4 4 0 0 1-8 0V3Z" /><path d="M12 17v4M8 21h8" />
        </svg>
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-widest">
          {fedLabel}
        </p>
        <h1 className="text-base font-bold text-slate-900 dark:text-slate-50 leading-tight truncate">
          {compName}
        </h1>
        {/* Temporada: texto plano si no hay histórico; selector discreto si lo hay.
            Decisión UX: la temporada actual es el 99% de las visitas — el
            selector no compite visualmente, parece un subtítulo con caret. */}
        {hasHistory ? (
          <select
            ref={selectRef}
            value={season.id}
            onChange={(e) => { wasFocused.current = true; router.push(`/competitions/${competitionId}?season=${e.target.value}`); }}
            className="mt-0.5 -ml-1 text-xs font-light text-slate-500 dark:text-slate-400 bg-transparent
                       border-0 rounded-md px-1 py-0 pr-6 cursor-pointer appearance-auto
                       hover:text-slate-600 dark:hover:text-slate-300
                       focus:outline-none focus:ring-1 focus:ring-rink-passion dark:focus:ring-rink-accent"
            aria-label={t('common.change_season')}
            aria-describedby="season-select-hint"
          >
            {seasons!.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}{s.isCurrent ? ` · ${t('common.current')}` : ''}
              </option>
            ))}
          </select>
        ) : (
          <p className="text-xs font-light text-slate-500 dark:text-slate-400">{season.name}</p>
        )}
        {/* Temporada que no acabó por calendario (p. ej. COVID-19): contexto, no error. */}
        <SeasonNoteLine competitionSlug={season.competitionSlug} seasonSlug={season.slug} />
        {/* 3.2.2: elegir temporada navega; se avisa antes de usar el control
            (descripción accesible enlazada con aria-describedby, #364). */}
        <span id="season-select-hint" className="sr-only">{t('common.change_season_hint')}</span>
      </div>

      {/* Compartir + favorito de liga */}
      <ShareButton kind="league" title={compName} className="shrink-0" />
      <FavoriteStar
        id={season.competitionId}
        kind="league"
        name={season.competitionShort ?? season.competitionName}
        className="shrink-0"
      />
      <ManageNotificationsButton
        kind="league"
        id={season.competitionId}
        name={season.competitionShort ?? season.competitionName}
        className="shrink-0"
      />
    </div>
  );
}
