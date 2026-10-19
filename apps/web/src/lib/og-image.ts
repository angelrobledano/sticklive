import type { Locale } from './locales';

/**
 * Ayudas para las imágenes que pinta `next/og` (Satori).
 *
 * Satori no decodifica WebP: si se le pasa un `data:image/webp` la respuesta
 * falla al hacer stream («failed to pipe response») y la ruta acaba en 502. La
 * API sirve fotos y escudos en WebP por peso, así que las rutas de OG deben
 * pedir explícitamente PNG y, aun así, rechazar cualquier otro formato.
 */

/**
 * Textos de las tarjetas OG por idioma (F3-5). Antes la tarjeta de un partido
 * servida en `/en` seguía diciendo «Local / Visitante / EN DIRECTO» y la fecha
 * se formateaba en `es-ES`.
 */
export interface OgCopy {
  home: string;
  away: string;
  live: string;
  final: string;
  hockey: string;
  competitionSubtitle: string;
  goalkeeper: string;
  goals: string;
  dateLocale: string;
}

export const OG_COPY: Record<Locale, OgCopy> = {
  es: {
    home: 'Local', away: 'Visitante', live: 'EN DIRECTO', final: 'FINAL',
    hockey: 'Hockey patines en directo', competitionSubtitle: 'Clasificación, calendario y resultados',
    goalkeeper: 'Portero', goals: 'goles', dateLocale: 'es-ES',
  },
  en: {
    home: 'Home', away: 'Away', live: 'LIVE', final: 'FINAL',
    hockey: 'Live rink hockey', competitionSubtitle: 'Standings, fixtures and results',
    goalkeeper: 'Goalkeeper', goals: 'goals', dateLocale: 'en-GB',
  },
  pt: {
    home: 'Casa', away: 'Visitante', live: 'EM DIRETO', final: 'FINAL',
    hockey: 'Hóquei em patins em direto', competitionSubtitle: 'Classificação, calendário e resultados',
    goalkeeper: 'Guarda-redes', goals: 'golos', dateLocale: 'pt-PT',
  },
  fr: {
    home: 'Domicile', away: 'Visiteur', live: 'EN DIRECT', final: 'FINAL',
    hockey: 'Rink hockey en direct', competitionSubtitle: 'Classement, calendrier et résultats',
    goalkeeper: 'Gardien', goals: 'buts', dateLocale: 'fr-FR',
  },
  it: {
    home: 'Casa', away: 'Ospite', live: 'IN DIRETTA', final: 'FINAL',
    hockey: 'Hockey su pista in diretta', competitionSubtitle: 'Classifica, calendario e risultati',
    goalkeeper: 'Portiere', goals: 'gol', dateLocale: 'it-IT',
  },
};

/** Copia de la tarjeta para un locale; cae a inglés si llega uno desconocido. */
export function ogCopy(locale: string | undefined | null): OgCopy {
  return OG_COPY[locale as Locale] ?? OG_COPY.en;
}

/** Ancho de la foto en la imagen de alineación (se pinta a 76 px). */
export const SATORI_PHOTO_WIDTH = 192;

/** URL de la foto del jugador en PNG, lista para Satori. */
export function playerPhotoUrlForSatori(
  apiBase: string,
  playerId: string,
  width = SATORI_PHOTO_WIDTH,
): string {
  const base = apiBase.replace(/\/+$/, '');
  return `${base}/players/${encodeURIComponent(playerId)}/photo?w=${width}&format=png`;
}

/** ¿Satori puede decodificar este `Content-Type`? Solo PNG y JPEG. */
export function isSatoriRenderableImage(contentType: string | null | undefined): boolean {
  const type = (contentType ?? '').split(';')[0]!.trim().toLowerCase();
  return type === 'image/png' || type === 'image/jpeg';
}

/** Ancho del escudo en las tarjetas OG (se pinta a 170–260 px). */
export const SATORI_LOGO_WIDTH = 256;

/** URL del escudo en PNG, lista para Satori. */
export function teamLogoUrlForSatori(apiBase: string, teamId: string): string {
  const base = apiBase.replace(/\/+$/, '');
  return `${base}/teams/${encodeURIComponent(teamId)}/logo?w=${SATORI_LOGO_WIDTH}&format=png`;
}

/** Iniciales para el fallback cuando no hay escudo (nunca un círculo vacío). */
export function teamInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '·';
  return words.slice(0, 2).map((word) => word[0]!.toUpperCase()).join('');
}
