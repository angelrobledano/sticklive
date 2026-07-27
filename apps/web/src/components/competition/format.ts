/**
 * Helpers de formato de la ficha de competición (fechas, etiquetas, nombres).
 * Funciones puras, sin React.
 */
import type { SeasonOverview, SeasonRound } from '@/lib/api/client';

export function fmtTime(iso: string | null): string {
  if (!iso) return '--:--';
  return new Date(iso).toLocaleTimeString('es-ES', {
    hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid',
  });
}

export function fmtDate(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('es-ES', {
    weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/Madrid',
  });
}

export function fedLabelFromSeason(season: SeasonOverview['season'], locale: string): string {
  if (season.competitionScope === 'regional') return season.competitionRegion ?? season.competitionOrganizer;
  if (season.competitionScope === 'international') return 'Internacional';
  try {
    return new Intl.DisplayNames([locale], { type: 'region' }).of(season.competitionCountry ?? '') ?? season.competitionOrganizer;
  } catch {
    return season.competitionOrganizer;
  }
}

/** YYYY-MM-DD en Europe/Madrid (clave de día estable). */
export function madridDay(iso: string | null): string | null {
  if (!iso) return null;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(iso));
}

/** "2026-06-20" → "Vie 20 jun" (sin desfase de zona). */
export function dayPillLabel(d: string): string {
  const s = new Date(`${d}T12:00:00`).toLocaleDateString('es-ES', {
    weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/Madrid',
  });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Etiqueta de una ronda, TRADUCIDA al idioma activo.
 *
 * Antes devolvía `r.name`, que en la base es texto libre en español
 * ("Jornada 5"): un usuario en inglés leía "Jornada 5". Para las jornadas
 * regulares el nombre es siempre "Jornada N", así que se descarta y se
 * renderiza desde `r.number` con la plantilla del locale — el dato canónico
 * (número + tipo) siempre viene de la API.
 *
 * Las fases de playoff conservan `r.name` de momento (nombres como "Cuartos de
 * final" o "Copa del Rey"); su traducción es la Fase B.
 */
export function roundLabel(r: SeasonRound, t: (key: string, vars?: Record<string, string | number>) => string): string {
  if (r.roundType === 'regular') return t('fixtures.matchday', { n: r.number });
  return r.name ? `Playoffs · ${r.name}` : `Playoffs ${r.number}`;
}

/** "ALABART GONZALEZ IGNACIO" o "Ferran Font Sánchez" → "Ignacio Alabart" estilo natural */
export function toLeaderName(raw: string): string {
  const clean = raw.replace(/\s+/g, ' ').trim();
  const isUpper = clean === clean.toUpperCase();
  const parts = clean.split(' ');
  const title = (s: string) => s.toLowerCase().replace(/(^|\s|-)\p{L}/gu, (m) => m.toUpperCase());
  if (!isUpper || parts.length === 1) return title(clean);
  // Formato fuente "APELLIDO APELLIDO NOMBRE" → "Nombre Apellido"
  return title(`${parts[parts.length - 1]} ${parts[0]}`);
}
