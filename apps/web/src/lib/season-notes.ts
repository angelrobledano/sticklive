/**
 * Notas editoriales de temporadas terminadas de forma anómala (dato curado).
 *
 * Algunas temporadas no acabaron por el calendario previsto (pandemia, …). En la
 * BD quedan con su clasificación pero sin partidos, así que la ficha parece un
 * año roto. Aquí se anota el motivo con un `code` (traducible) y el dato concreto
 * (la jornada). Misma decisión de producto que `competition-importance`: mapa
 * indexado por slug estable (competición + temporada), lógica pura y testeada.
 * Ver issue #389.
 *
 * Caso documentado: OK Liga Masculina 2019/20 — la RFEP dio por finalizada la
 * competición con la clasificación vigente al decretarse el Estado de Alarma
 * (jornada 25), por COVID-19.
 */
export type SeasonNoteCode = 'covid';

export interface SeasonNote {
  code: SeasonNoteCode;
  /** Jornada en que se dio por finalizada la competición. */
  matchday: number;
}

/** Clave `competitionSlug/seasonSlug` → nota. Ampliar aquí si aparece otro caso. */
export const SEASON_NOTES: Record<string, SeasonNote> = {
  'ok-liga-masculina/2019-20': { code: 'covid', matchday: 25 },
};

/** Nota de la temporada, o `null` si no hay ninguna anotada. */
export function seasonNote(
  competitionSlug?: string | null,
  seasonSlug?: string | null,
): SeasonNote | null {
  if (!competitionSlug || !seasonSlug) return null;
  return SEASON_NOTES[`${competitionSlug}/${seasonSlug}`] ?? null;
}

/** Clave i18n del texto de la nota (interpolable con `{matchday}`). */
export function seasonNoteI18nKey(code: SeasonNoteCode): string {
  return `season.note.${code}`;
}
