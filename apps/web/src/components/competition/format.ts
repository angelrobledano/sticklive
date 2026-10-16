/**
 * Helpers de formato de la ficha de competición (fechas, etiquetas, nombres).
 * Funciones puras, sin React.
 */
import type { SeasonOverview, SeasonRound } from '@/lib/api/client';
import { APP_TZ } from '@/lib/match-time';
import { isKnockoutStage, stageLabel } from '@/lib/stage-label';

/**
 * Hora/fecha de un partido en la zona de SU competición (columna 042). Cae a
 * Europe/Madrid cuando no viene. En la ficha de competición toda la vista es una
 * única competición, así que agrupar y formatear en su TZ es coherente (para las
 * ligas ES no cambia nada; para una liga PT/IT en hora local, cuadra el día).
 */
export function fmtTime(iso: string | null, tz?: string | null, locale = 'es'): string {
  if (!iso) return '--:--';
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

/** YYYY-MM-DD en la TZ de la competición (default Madrid): clave de día estable. */
export function madridDay(iso: string | null, tz?: string | null): string | null {
  if (!iso) return null;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz || APP_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(iso));
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

/**
 * Fase de eliminatoria como CLAVE canónica, derivada del nombre (que la fuente
 * da en español/inglés) o, si no hay pista textual, del número de ronda — la
 * misma regla que usa `groupByPhase` en `lib/playoff`.
 *
 * Devuelve `null` cuando no se reconoce la fase: son nombres propios no
 * traducibles ("Copa del Rey"), que el llamante muestra tal cual.
 */
export type PlayoffPhaseKey = 'round_of_16' | 'quarters' | 'semis' | 'final' | 'third_place';

export function playoffPhaseKey(name: string | null, roundNumber: number | null): PlayoffPhaseKey | null {
  const n = (name ?? '').toLowerCase();
  // Octavos ANTES que final: "octavos de final" contiene "final" y se
  // clasificaba mal como la gran final.
  if (/octavos|1\s*\/\s*8|round\s*of\s*16|eighth/.test(n)) return 'round_of_16';
  if (/cuartos|quarter/.test(n)) return 'quarters';
  if (/semi/.test(n)) return 'semis';
  if (/3.*4|tercer|bronce|small\s*final|3º|3rd|third/.test(n)) return 'third_place';
  if (/final/.test(n)) return 'final';
  // Sin pista en el texto: derivar del número (igual que groupByPhase).
  if (roundNumber != null) {
    if (roundNumber >= 3) return 'final';
    if (roundNumber === 2) return 'semis';
    if (roundNumber === 1) return 'quarters';
  }
  return null;
}

const PHASE_KEYS = new Set<PlayoffPhaseKey>(['round_of_16', 'quarters', 'semis', 'final', 'third_place']);

/**
 * Fase eliminatoria de un partido o ronda: la EXPLÍCITA de la fuente (`stage`)
 * manda; solo si no viene (temporadas heredadas) se deduce del nombre/número.
 * `placement` (colocación) no es una fase del cuadro por el título → null.
 */
export function matchPhaseKey(m: {
  stage?: string | null;
  roundName?: string | null;
  roundNumber?: number | null;
}): PlayoffPhaseKey | null {
  if (m.stage) return PHASE_KEYS.has(m.stage as PlayoffPhaseKey) ? (m.stage as PlayoffPhaseKey) : null;
  return playoffPhaseKey(m.roundName ?? null, m.roundNumber ?? null);
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
