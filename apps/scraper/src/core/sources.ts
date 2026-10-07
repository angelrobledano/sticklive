/**
 * Registro de FUENTES de datos.
 *
 * Todas las fuentes que conocemos hasta hoy corren sobre la misma plataforma
 * (sidgad) y sólo se diferencian en tres cosas: el portal HTTP, el prefijo de
 * sus `source_ref` y poco más. Antes eso estaba disuelto por el código en forma
 * de literales `'fep_match_'`, `'fep_competition_'` y un cliente HTTP fijo, de
 * modo que **sólo la FEP tenía actas**: `cron-live` filtraba con
 * `source_ref LIKE 'fep_match_%'` y descartaba el resto en silencio.
 *
 * Se vio en el Europeo Sub-17 de julio de 2026: los partidos de World Skate
 * mostraban marcador pero nunca cronología, porque su acta jamás se pedía.
 *
 * Añadir una fuente nueva que use sidgad debería ser añadir una entrada aquí.
 */
import type { SidgadClientConfig } from '../scrapers/fep/sidgad-client.js';

export interface SourceDef {
  /** Clave corta, también prefijo de los `source_ref`: 'fep' | 'wse'. */
  key: string;
  /** Nombre legible, para logs. */
  name: string;
  /** Configuración del cliente HTTP (portal, dominio, referer). */
  client: SidgadClientConfig;
}

/** `fep_match_34259` → 'fep_'.  Los refs siguen siempre `{key}_{entidad}_{id}`. */
const matchPrefix  = (s: SourceDef) => `${s.key}_match_`;
const compPrefix   = (s: SourceDef) => `${s.key}_competition_`;

export const SOURCES: SourceDef[] = [
  {
    key: 'fep',
    name: 'RFEP — Hockey Patines',
    client: {
      baseUrl: 'https://www.server2.sidgad.es/rfep',
      portalPrefix: 'rfep',
      referer: 'https://www.hockeypatines.fep.es/',
    },
  },
  {
    key: 'wse',
    name: 'World Skate Europe',
    client: {
      baseUrl: 'https://www.server2.sidgad.es/worldskate',
      portalPrefix: 'worldskate',
      referer: 'https://wse.sidgad.com/',
    },
  },
];

/** Fuente a la que pertenece un `matches.source_ref`, o null si no la conocemos. */
export function sourceForMatchRef(sourceRef: string | null | undefined): SourceDef | null {
  if (!sourceRef) return null;
  return SOURCES.find((s) => sourceRef.startsWith(matchPrefix(s))) ?? null;
}

/** `fep_match_34259` → `34259`. Devuelve null si el ref no es de esa fuente. */
export function idpFromMatchRef(sourceRef: string, source: SourceDef): string | null {
  const prefix = matchPrefix(source);
  return sourceRef.startsWith(prefix) ? sourceRef.slice(prefix.length) : null;
}

/** `fep_competition_3150` → `3150`. Tolera un ref ya limpio o vacío. */
export function idcFromCompetitionRef(sourceRef: string | null | undefined, source: SourceDef): string {
  if (!sourceRef) return '';
  const prefix = compPrefix(source);
  return sourceRef.startsWith(prefix) ? sourceRef.slice(prefix.length) : sourceRef;
}

/**
 * Prefijo de los `source_ref` de EVENTOS: `fep_event_`, `wse_event_`…
 *
 * Importante que sea por fuente y no global: cambiar el prefijo de una fuente
 * ya cargada reescribiría todos sus refs, y con ellos los ids de sus eventos,
 * que es justo lo que la migración 035 vino a estabilizar. Los eventos de la
 * FEP conservan `fep_event_` y los nuevos de cada fuente nacen con el suyo.
 */
export function eventPrefix(source: SourceDef): string {
  return `${source.key}_event_`;
}

/** Fuente por clave, para los sitios que la tienen explícita. */
export function sourceByKey(key: string): SourceDef {
  const s = SOURCES.find((x) => x.key === key);
  if (!s) throw new Error(`Fuente desconocida: ${key}. Añádela en core/sources.ts`);
  return s;
}

export interface MatchSourceIds {
  source: SourceDef;
  /** Id de partido en la fuente (`idp`). */
  idp: string;
  /** Id de competición en la fuente (`idc`). */
  idc: string;
}

/**
 * Resuelve {fuente, idp, idc} de un partido a partir de sus refs, o `null` si
 * el `source_ref` no es de ninguna fuente conocida (o no lleva idp). Es la
 * puerta única para los flujos de fichas: cron-live y el barrido de
 * fichas-pendientes comparten esta resolución multi-fuente.
 */
export function resolveMatchSourceIds(
  sourceRef: string | null | undefined,
  compRef: string | null | undefined,
): MatchSourceIds | null {
  const source = sourceForMatchRef(sourceRef);
  if (!source) return null;
  const idp = idpFromMatchRef(sourceRef!, source);
  if (!idp) return null;
  return { source, idp, idc: idcFromCompetitionRef(compRef, source) };
}
