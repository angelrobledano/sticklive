import { notFound, permanentRedirect } from 'next/navigation';
import { getEntityRedirect, type EntityRedirect, type EntityRedirectType } from '@/lib/api/client';
import type { Locale } from '@/lib/locales';

/**
 * Fichas que ya no existen (F1-7, migración 073 y `GET /redirects/:type/:id`).
 *
 * Antes de responder 404 se consulta si otra entidad sustituye a la borrada
 * (fusión de competiciones, placeholder adoptado por el partido real, filial
 * revertido). Si la hay, 308 a su ficha en el mismo idioma: conserva enlaces,
 * URLs compartidas y lo que Google tenía indexado.
 */
export type RedirectEntityType = EntityRedirectType;

const SEGMENT: Record<RedirectEntityType, string> = {
  competition: 'competitions',
  team: 'teams',
  player: 'players',
  match: 'matches',
};

/**
 * Periodo de gracia de una ficha oculta por calidad (F1-6, §5.3 de la
 * auditoría SEO). Una revisión corta no debe costar la indexación: durante
 * estas horas se responde 5xx (Google reintenta y conserva la URL). Pasado el
 * plazo, 404 como antes.
 */
export const HIDDEN_GRACE_HOURS = 72;

/**
 * La ficha existe pero está oculta por una revisión de calidad reciente. Se
 * lanza para que la respuesta sea 5xx (error boundary) y no 404.
 */
export class TemporarilyHiddenError extends Error {
  constructor(type: RedirectEntityType, id: string) {
    super(`${type} ${id} oculto temporalmente por revisión de datos`);
    this.name = 'TemporarilyHiddenError';
  }
}

function withinGrace(since: string | null, now = Date.now()): boolean {
  if (!since) return false;
  const t = Date.parse(since);
  return Number.isFinite(t) && now - t < HIDDEN_GRACE_HOURS * 3600_000;
}

/**
 * Responde 308 al sustituto si existe, 5xx si la ficha está oculta por una
 * revisión reciente y 404 en cualquier otro caso. Nunca vuelve.
 */
export async function redirectOrNotFound(
  type: RedirectEntityType,
  id: string,
  locale: Locale,
): Promise<never> {
  let resolution: EntityRedirect | null = null;
  try {
    resolution = await getEntityRedirect(type, id);
  } catch {
    // Sin registro (404) o fallo de la consulta: la ficha no existe, 404 normal.
  }
  if (resolution?.status === 'moved' && resolution.newId) {
    permanentRedirect(`/${locale}/${SEGMENT[type]}/${resolution.newId}`);
  }
  if (resolution?.status === 'hidden' && withinGrace(resolution.since)) {
    throw new TemporarilyHiddenError(type, id);
  }
  notFound();
}
