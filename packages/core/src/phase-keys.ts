/**
 * Claves canónicas de fase eliminatoria y clave de día en la zona de la
 * competición. Funciones puras, compartidas por la web y la app.
 */
import { APP_TZ } from './match-time';

/** YYYY-MM-DD en la TZ de la competición (default Madrid): clave de día estable. */
export function madridDay(iso: string | null, tz?: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz || APP_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
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
