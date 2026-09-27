/**
 * Fecha corta SIN año del feed de marcadores de la FEP ("23/05 12:30").
 *
 * El año no viene en la fuente, así que se elige el candidato más CERCANO a
 * ahora entre año-1, año y año+1. Antes se asumía el año en curso y solo se
 * restaba uno si el candidato quedaba >180 días en el futuro, lo que entre
 * Navidad y Año Nuevo mandaba un partido del 2 de enero al enero del año
 * ANTERIOR (12 meses atrás) hasta el siguiente scrape de calendario. Issue #167.
 *
 * Función pura y testeada (no arrastra el scraper, que exige entorno al importar).
 */
import { zonedToUtc } from '../../core/eu-timezone.js';

/** Zona de la fuente FEP (hora española) si la competición no trae otra. */
const DEFAULT_TIMEZONE = 'Europe/Madrid';

export function parseShortDatetime(text: string | null | undefined, now: Date = new Date()): Date | undefined {
  if (!text) return undefined;
  // Formato: "DD/MM HH:MM"
  const m = text.match(/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})/);
  if (!m) return undefined;

  const day   = parseInt(m[1]!, 10);
  const month = parseInt(m[2]!, 10) - 1; // 0-based
  const hour  = parseInt(m[3]!, 10);
  const min   = parseInt(m[4]!, 10);

  const baseYear = now.getFullYear();
  let best: Date | undefined;
  let bestDelta = Number.POSITIVE_INFINITY;

  for (const year of [baseYear - 1, baseYear, baseYear + 1]) {
    const d = zonedToUtc(DEFAULT_TIMEZONE, year, month, day, hour, min);
    if (isNaN(d.getTime())) continue;
    const delta = Math.abs(d.getTime() - now.getTime());
    if (delta < bestDelta) {
      best = d;
      bestDelta = delta;
    }
  }
  return best;
}
