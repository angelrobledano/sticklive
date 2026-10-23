import { isUuid } from './uuid.js';

/**
 * Clave pública de una competición en la ruta (plan de URLs legibles, Plan A):
 * la ficha se direcciona por su slug (`/competitions/ok-liga-masculina`), pero
 * las URLs antiguas con UUID siguen resolviendo para poder responder 301.
 *
 * Devuelve `null` si el parámetro no es ni UUID ni un slug bien formado, para
 * responder 404 sin tocar la BD (mismo criterio que #275).
 */
export type CompetitionKey = { by: 'id'; value: string } | { by: 'slug'; value: string };

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_SLUG_LENGTH = 120;

export function isCompetitionSlug(value: unknown): value is string {
  return typeof value === 'string'
    && value.length <= MAX_SLUG_LENGTH
    && SLUG_RE.test(value)
    && !isUuid(value);
}

export function parseCompetitionKey(param: string): CompetitionKey | null {
  if (isUuid(param)) return { by: 'id', value: param };
  if (isCompetitionSlug(param)) return { by: 'slug', value: param };
  return null;
}
