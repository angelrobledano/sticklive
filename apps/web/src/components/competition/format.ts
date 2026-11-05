/**
 * Helpers de formato de la ficha de competición (fechas, etiquetas, nombres).
 * Funciones puras, sin React.
 */
import type { SeasonOverview, SeasonRound } from '@/lib/api/client';
import { APP_TZ, isTimeTbd, timeTbdLabel } from '@sports/core/match-time';
import { isKnockoutStage, stageLabel } from '@sports/core/stage-label';
import { playerDisplayName } from '@sports/core/names';
import { playoffPhaseKey } from '@sports/core/phase-keys';

// Claves de fase y clave de día: viven en core, aquí se reexportan para no tocar a los llamantes.

/**
 * Hora/fecha de un partido en la zona de SU competición (columna 042). Cae a
 * Europe/Madrid cuando no viene. En la ficha de competición toda la vista es una
 * única competición, así que agrupar y formatear en su TZ es coherente (para las
 * ligas ES no cambia nada; para una liga PT/IT en hora local, cuadra el día).
 */
export function fmtTime(iso: string | null, tz?: string | null, locale = 'es'): string {
  if (!iso) return '--:--';
  if (isTimeTbd(iso)) return timeTbdLabel(locale);
  // Ciclo horario forzado a 23 (0-23): con locale 'en' el defecto es 12h AM/PM,
  // impropio de un producto europeo (#413). Válido en todos los locales.
  return new Date(iso).toLocaleTimeString(locale, {
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: tz || APP_TZ,
  });
}

export function fmtDate(iso: string | null, tz?: string | null, locale = 'es'): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString(locale, {
    weekday: 'short', day: 'numeric', month: 'short', timeZone: tz || APP_TZ,
  });
}

export function fedLabelFromSeason(season: SeasonOverview['season'], locale: string): string {
  if (season.competitionScope === 'regional') return season.competitionRegion ?? season.competitionOrganizer;
  // Internacional: el organizador es más informativo que un genérico
  // ("World Skate", "WSE") y casa con la categoría "Mundo" del índice.
  if (season.competitionScope === 'international') return season.competitionOrganizer || 'Internacional';
  try {
    return new Intl.DisplayNames([locale], { type: 'region' }).of(season.competitionCountry ?? '') ?? season.competitionOrganizer;
  } catch {
    return season.competitionOrganizer;
  }
}

/** "2026-06-20" → "Vie 20 jun" (mediodía UTC, no cruza fecha entre zonas). */
export function dayPillLabel(d: string, locale = 'es'): string {
  const s = new Date(`${d}T12:00:00Z`).toLocaleDateString(locale, {
    weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC',
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
  // Ronda eliminatoria con fase de la fuente (spec 2026-10-16): «Cuartos de
  // final», «Semifinales», «Final», «3.er y 4.º puesto» traducidos; la
  // colocación lleva el nombre de la fuente («Puestos 5º-8º»).
  if (isKnockoutStage(r.stage)) {
    return stageLabel(r.stage, t) ?? r.name ?? t('playoffs.other_places');
  }
  return r.name ? `Playoffs · ${r.name}` : `Playoffs ${r.number}`;
}

/** Etiqueta de fase traducida; cae al nombre propio si no es una fase conocida. */
export function playoffPhaseLabel(
  name: string | null,
  roundNumber: number | null,
  t: (key: string, vars?: Record<string, string | number>) => string,
): string {
  const key = playoffPhaseKey(name, roundNumber);
  return key ? t(`playoffs.${key}`) : (name ?? '');
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

/**
 * Nombre de presentación de un líder de estadísticas. Con nombre y apellidos
 * de la ficha (API ≥ C0) es exacto ("Juan Gabriel Fernandez"); sin ellos, se
 * deduce del nombre crudo del acta.
 */
export function leaderDisplayName(l: { playerName: string; firstName?: string | null; lastName?: string | null }): string {
  return l.firstName && l.lastName ? playerDisplayName(l.firstName, l.lastName) : toLeaderName(l.playerName);
}
