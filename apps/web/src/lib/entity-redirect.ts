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

/** Responde 308 al sustituto si existe y 404 en cualquier otro caso. Nunca vuelve. */
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
  notFound();
}
