import { isUuid } from '@/lib/uuid';

/**
 * Ruta pública de una competición (Plan A de URLs legibles):
 * `/competitions/<slug>` cuando hay un slug válido y `/competitions/<id>` si no
 * (la ficha con UUID responde 308 al slug). Sin prefijo de idioma: lo pone
 * `LocaleLink` / `withLocaleHref`.
 */
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isCompetitionSlug(value: string | null | undefined): value is string {
  return !!value && SLUG_RE.test(value) && !isUuid(value);
}

export function competitionKey(id: string, slug?: string | null): string {
  return isCompetitionSlug(slug) ? slug : id;
}

export function competitionPath(
  id: string,
  slug?: string | null,
  seasonId?: string | null,
): string {
  const base = `/competitions/${competitionKey(id, slug)}`;
  return seasonId ? `${base}?season=${encodeURIComponent(seasonId)}` : base;
}
