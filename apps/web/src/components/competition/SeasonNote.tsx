'use client';

import { useT } from '@/lib/i18n';
import { tt } from '@/components/search/translate';
import { seasonNote, seasonNoteI18nKey } from '@/lib/season-notes';

/**
 * Línea discreta que explica por qué una temporada acabó antes de tiempo (p. ej.
 * COVID-19). Se apoya en `season-notes` (dato curado). Es contexto, no un error:
 * el copy y el color no alarman. No renderiza nada si la temporada no tiene nota.
 */
export function SeasonNoteLine({ competitionSlug, seasonSlug }: {
  competitionSlug?: string | null;
  seasonSlug?: string | null;
}) {
  const { t } = useT();
  const note = seasonNote(competitionSlug, seasonSlug);
  if (!note) return null;
  return (
    <p className="mt-0.5 text-[11px] font-light text-slate-400 dark:text-slate-500">
      {tt(
        t,
        seasonNoteI18nKey(note.code),
        'Temporada finalizada por COVID-19 en la jornada {matchday}',
        { matchday: note.matchday },
      )}
    </p>
  );
}
