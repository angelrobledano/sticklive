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
  // Federaciones autonómicas (mismo registro que apps/etl/src/federations.ts).
  // Antes se cargaban con SIDGAD_PORTAL y la fuente `fep`: sus refs nacían
  // `fep_*` y chocaban con los ids de RFEP (A1, análisis OKMob 22/10/2026).
  {
    key: 'fecapa',
    name: 'FECAPA — Hoquei Patins (Catalunya)',
    client: {
      baseUrl: 'https://www.server2.sidgad.es/fecapa',
      portalPrefix: 'fecapa',
      referer: 'https://www.fecapa.cat/',
    },
  },
  {
    key: 'fmp',
    name: 'FMP — Hockey Patines (Madrid)',
    client: {
      baseUrl: 'https://www.server2.sidgad.es/fmp',
      portalPrefix: 'fmp',
      referer: 'https://www.hockeypatines.fmp.es/',
    },
  },
  {
    key: 'fap',
    name: 'FAP — Hockey Patines (Andalucía)',
    client: {
      baseUrl: 'https://www.server2.sidgad.es/fap',
      portalPrefix: 'fap',
      referer: 'https://www.hockeypatines.fapatinaje.org/',
    },
  },
  {
    key: 'fpcv',
    name: 'FPCV — Hockey Patines (C. Valenciana)',
    client: {
      baseUrl: 'https://www.server2.sidgad.es/fpcv',
      portalPrefix: 'fpcv',
      referer: 'https://www.fpcv.es/',
    },
  },
  {
    key: 'fgp',
    name: 'FGP — Hockey Patines (Galicia)',
    client: {
      baseUrl: 'https://www.server2.sidgad.es/fgpatinaxe',
      portalPrefix: 'fgpatinaxe',
      referer: 'https://www.hockeypatines.fgpatinaxe.gal/',
    },
  },
  // Italia: Federazione Italiana Sport Rotellistici (hockey pista).
  {
    key: 'fisr',
    name: 'FISR — Hockey Pista (Italia)',
    client: {
      baseUrl: 'https://www.server2.sidgad.es/fisr',
      portalPrefix: 'fisr',
      referer: 'https://hockeypista.fisr.it/',
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

/** Fuente de un portal sidgad (`rfep`, `fecapa`, `worldskate`…). Lanza si no la conocemos. */
export function sourceForPortal(portal: string): SourceDef {
  const s = SOURCES.find((x) => x.client.portalPrefix === portal);
  if (!s) throw new Error(`Portal sidgad desconocido: ${portal}. Añádelo en core/sources.ts`);
  return s;
}

/**
 * Fuente del proceso actual: la marca `SIDGAD_PORTAL` (rfep por defecto). Los
 * scrapers que corren "por portal" (calendario, directo, fichas) la usan para
 * que sus refs lleven el portal correcto.
 */
export function currentSource(env: Record<string, string | undefined> = process.env): SourceDef {
  return sourceForPortal(env['SIDGAD_PORTAL'] ?? 'rfep');
}

/**
 * Prefijo de los `source_ref` de JUGADOR. RFEP conserva `fep_player_` (lo ya
 * cargado). El resto lleva su clave: cada portal numera a sus jugadores por
 * separado y sin prefijo propio dos personas distintas comparten fila.
 */
export function playerPrefix(source: SourceDef): string {
  return `${source.key}_player_`;
}

/** `matchRef(fecapa, '164291')` → `fecapa_match_164291`. */
export function matchRef(source: SourceDef, idp: string): string {
  return `${matchPrefix(source)}${idp}`;
}

/** `competitionRef(fecapa, '4858')` → `fecapa_competition_4858`. */
export function competitionRef(source: SourceDef, idc: string): string {
  return `${compPrefix(source)}${idc}`;
}

/** Prefijos de partido de todas las fuentes, para filtros SQL (`LIKE ANY`). */
export function matchRefLikePatterns(): string[] {
  return SOURCES.map((s) => `${matchPrefix(s)}%`);
}

/** `fecapa_player_14782` → `{ sourceKey: 'fecapa', id: '14782' }`. */
export function playerIdFromRef(ref: string | null | undefined): { sourceKey: string; id: string } | null {
  const m = /^([a-z]+)_player_([A-Za-z0-9]+)$/.exec(ref ?? '');
  if (!m || !SOURCES.some((s) => s.key === m[1])) return null;
  return { sourceKey: m[1]!, id: m[2]! };
}

/** `clubRef(rfep, '69')` → `fep_club_69`. Id de CLUB sidgad (estable), no de inscripción. */
export function clubRef(source: SourceDef, id: string): string {
  return `${source.key}_club_${id}`;
}

/** ¿Es una ref de club sidgad de alguna fuente conocida? */
export function isClubRef(ref: string): boolean {
  return SOURCES.some((s) => ref.startsWith(`${s.key}_club_`));
}

/**
 * `competitions.source_ref` que escribe el seed. RFEP conserva el idc tal cual
 * (es lo sembrado desde el principio); el resto lleva su portal para que un
 * idc de FECAPA no se confunda con uno de RFEP o World Skate (`260`).
 */
export function competitionSourceRefForSeed(source: SourceDef, idc: string): string {
  return source.key === 'fep' ? idc : competitionRef(source, idc);
}
