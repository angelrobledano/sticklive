// ============================================================
// Tipos compartidos entre scraper, ETL y API
// ============================================================

/**
 * Horas tras el inicio a partir de las cuales un partido que sigue `live` se
 * considera atascado (el `stale-live-watchdog` del ETL lo cierra; allí es
 * configurable con el env `STALE_LIVE_HOURS`).
 *
 * Ya NO define ninguna ventana "en juego por reloj": un partido solo está en
 * directo si la fuente lo dice (ver `resolveStatusTransition` y
 * `matchDisplayState` más abajo). La presentación de un `scheduled` con la hora
 * pasada usa `OVERDUE_AFTER_HOURS`.
 */
export const STALE_LIVE_HOURS = 5;

export type SportSlug = 'hockey-patines' | string;

export type MatchStatus =
  | 'scheduled' | 'live' | 'halftime' | 'overtime' | 'penalty_shootout'
  | 'finished' | 'postponed' | 'cancelled';

/** Cómo se decidió un partido de eliminatoria. */
export type WinType = 'regular' | 'overtime' | 'penalties';

/**
 * Resultado completo de un partido que puede ir a prórroga/penaltis.
 * `home/awayGoals` es el marcador mostrado (incluye prórroga). El reglamentario
 * y la tanda se guardan aparte para poder mostrar el contexto de la victoria.
 */
export interface MatchResult {
  homeGoals: number;
  awayGoals: number;
  homeGoalsRegular?: number | null;
  awayGoalsRegular?: number | null;
  homePenalties?: number | null;
  awayPenalties?: number | null;
  winnerTeamId?: string | null;
  winType?: WinType | null;
}
export type Gender = 'male' | 'female' | 'mixed' | 'unknown';
export type RoundType = 'regular' | 'playoff' | 'cup' | 'friendly';
export type EventType = 'goal' | 'penalty' | 'blue_card' | 'red_card' | 'timeout' | 'period_end';
export type ScrapeStatus = 'success' | 'error' | 'skipped' | 'partial';

/** Nivel de seguimiento de notificaciones por entidad seguida (equipo/competición/jugador). */
export type NotificationPreset = 'complete' | 'key_events' | 'results' | 'silent';

// ============================================================
// Entidades de dominio (lo que circula por el sistema)
// ============================================================

export interface DataSource {
  id: string;
  name: string;
  baseUrl: string;
  scraperKey: string;
}

export interface Sport {
  id: string;
  name: string;
  slug: SportSlug;
}

export interface Competition {
  id: string;
  sportId: string;
  name: string;
  shortName?: string;
  slug: string;
  gender?: Gender;
  category?: string;
  country: string;
}

export interface Season {
  id: string;
  competitionId: string;
  name: string;
  slug: string;
  startDate?: string;
  endDate?: string;
  isCurrent: boolean;
}

export interface Team {
  id: string;
  sportId: string;
  name: string;
  shortName?: string;
  slug: string;
  city?: string;
  logoUrl?: string;
}

export interface Player {
  id: string;
  sportId: string;
  firstName: string;
  lastName: string;
  slug: string;
  birthDate?: string;
  nationality?: string;
  position?: string;
}

export interface Round {
  id: string;
  seasonId: string;
  number: number;
  name?: string;
  roundType: RoundType;
  startDate?: string;
  endDate?: string;
}

export interface Match {
  id: string;
  seasonId: string;
  roundId?: string;
  homeTeamId: string;
  awayTeamId: string;
  homeScore?: number;
  awayScore?: number;
  status: MatchStatus;
  scheduledAt?: string;
  venueName?: string;
  venueCity?: string;
  videoUrl?: string;
}

export interface Standing {
  id: string;
  seasonId: string;
  teamId: string;
  groupName?: string;
  position?: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
  form?: string[];
}

export interface MatchEvent {
  id: string;
  matchId: string;
  teamId?: string;
  playerId?: string;
  eventType: EventType;
  minute?: number;
  period?: number;
  detail?: string;
}

// ============================================================
// DTOs del scraper (datos crudos antes de normalizar)
// ============================================================

export interface ScrapedTrace {
  sourceId: string;
  sourceRef?: string;
  sourceUrl?: string;
  scrapedAt: Date;
}

export type ScrapedCompetition = Omit<Competition, 'id' | 'sportId'> & ScrapedTrace & {
  rawName: string;
};

export type ScrapedTeam = Omit<Team, 'id' | 'sportId'> & ScrapedTrace & {
  rawName: string;
};

export type ScrapedMatch = Omit<Match, 'id' | 'homeTeamId' | 'awayTeamId'> & ScrapedTrace & {
  homeTeamRef: string;
  awayTeamRef: string;
  /**
   * Nombre de la competición que trae la fila (el feed de directo no incluye el
   * id de competición). Se usa para casar la fila con el partido ya creado por
   * el calendario cuando los equipos vienen por ref de club (no resolubles).
   */
  competitionName?: string | null;
  /** Abreviatura del equipo que trae la fila del feed (3 letras). Rellena `teams.short_name`. */
  homeTeamAbbr?: string | null;
  awayTeamAbbr?: string | null;
  /** URL del escudo del equipo que trae la fila (CDN). Rellena `teams.logo_url` si falta. */
  homeTeamLogoUrl?: string | null;
  awayTeamLogoUrl?: string | null;
  /** Nombre de ronda/fase de la fuente (Jornada 1, Cuartos, Final…) — para mostrar. */
  roundRef?: string;
  /** Número de ronda para la identidad en DB (UNIQUE season+number+type). Requerido si se crean rondas. */
  roundNumber?: number;
  /** Tipo de ronda; por defecto 'regular'. */
  roundType?: RoundType;
  /**
   * Grupo de la fase de grupos al que pertenece el partido ("A", "B"...).
   * Solo en fases de grupos; en eliminatorias es NULL (cada equipo viene de
   * un grupo distinto). Alimenta `matches.group_name`.
   */
  groupName?: string | null;
  /** Id de fase en la fuente (`fep_fase_3483`): bloque `content_fase_X` del calendario. */
  phaseRef?: string;
  /** Título de la fase en la fuente ("PLAY OFF OK LIGA"), si lo trae. */
  phaseName?: string | null;
  /** UUID de la fase ya resuelta por el ETL (migración 072). */
  phaseId?: string;
  /** Tipo de fase resuelto (`planSourceStructure`/`resolvePhaseKind`). */
  phaseKind?: PhaseKind;
  /** Fase de colocación (no decide el título). */
  phaseIsPlacement?: boolean;
  /** Orden de la fase en la temporada. */
  phaseOrdinal?: number;
  /** Evidencia con la que se resolvió el tipo de fase. */
  phaseResolvedBy?: StructureEvidence;
  /** Fase eliminatoria canónica de la ronda (cuartos, semis…). */
  stage?: KnockoutStage | null;
  /** Nº de partido dentro de la eliminatoria ("2 CUARTOS" → 2). */
  seriesGame?: number | null;
};

export type ScrapedStanding = Omit<Standing, 'id' | 'seasonId' | 'teamId'> & ScrapedTrace & {
  teamRef: string;
  logoUrl?: string;
  /** Abreviatura del equipo que trae la tabla (`.mobile`). Rellena `teams.short_name`. */
  abbreviation?: string | null;
  /** Título de la fase que publica la fuente sobre la tabla (A7): liga la clasificación a su fase. */
  phaseTitle?: string;
};

/**
 * Ronda/fase como estructura de datos (calendarios multi-fase, p. ej. World
 * Skate): se emite AUNQUE la fase aún no tenga partidos (eliminatorias cuyos
 * participantes publica la fuente más tarde), para que la UI pueda mostrar
 * la estructura de la competición desde el primer día.
 */
export interface ScrapedRound {
  seasonId: string;
  /** Número canónico de ronda (UNIQUE season+fase+number+type). */
  number: number;
  /** Nombre canónico ES ("Jornada 3", "Cuartos de final", "Final"...). */
  name?: string;
  roundType?: RoundType;
  sourceId: string;
  scrapedAt: Date;
  /** Fase de la fuente a la que pertenece (ver ScrapedMatch.phase*). */
  phaseRef?: string;
  phaseName?: string | null;
  phaseKind?: PhaseKind;
  phaseIsPlacement?: boolean;
  phaseOrdinal?: number;
  phaseResolvedBy?: StructureEvidence;
  stage?: KnockoutStage | null;
}

// ============================================================
// Resultados de ejecucion de scrapers
// ============================================================

export interface ScrapeResult<T> {
  success: boolean;
  data: T[];
  errors: ScrapeError[];
  durationMs: number;
  scraperKey: string;
  entityType: string;
}

export interface ScrapeError {
  message: string;
  url?: string;
  entityRef?: string;
  stack?: string;
}

// ============================================================
// Reglas de dominio compartidas (puras): estado del partido y
// estructura de competición (fases).
//
// Viven EN ESTE FICHERO (no en módulos aparte re-exportados) a propósito:
// la app móvil consume este paquete con Metro, que no traduce los imports
// relativos `./x.js` → `./x.ts` de la resolución Node16. Un único fichero
// fuente funciona igual en Node (tsx/esbuild), Next (transpilePackages),
// Vitest y Metro. Tests: match-status.test.ts y competition-structure.test.ts.
// ============================================================

// ── Estado del partido ──
/**
 * Estado de un partido — fuente ÚNICA de las reglas (scraper, ETL, API, web, app).
 *
 * Principio: el estado pertenece al PARTIDO y lo dice la FUENTE. La hora prevista
 * nunca basta para declarar un partido en juego: un partido previsto a las 18:00
 * que empieza a las 18:15 no está "en vivo" a las 18:00, y uno que la fuente da
 * en juego lo está aunque la hora prevista no cuadre (retrasos, zona horaria).
 *
 * Por eso cada escritor entrega una OBSERVACIÓN explícita o nada:
 *   - feed en vivo (`*_mc_1.php`): clase scorer_game_playing/final/pending.
 *   - acta (`#game_period.periodo_fin`): fin de partido.
 *   - calendario: resultado publicado → finished. Sin resultado → SIN señal.
 * y `resolveStatusTransition` decide el estado resultante. Una fuente que no sabe
 * nada del estado (undefined/null) NO puede cambiarlo.
 *
 * Los descansos/periodos son subestado del directo (`live_period`,
 * `live_is_halftime`), no estados propios: no cambian lo que consumen API/app.
 *
 * Funciones puras, sin I/O ni relojes implícitos (el `now` se inyecta).
 */

/** Estados persistidos (CHECK de `matches.status`). */
export const CORE_MATCH_STATUSES = ['scheduled', 'live', 'finished', 'postponed', 'cancelled'] as const;
export type CoreMatchStatus = typeof CORE_MATCH_STATUSES[number];

const CORE = new Set<string>(CORE_MATCH_STATUSES);

export function isCoreMatchStatus(s: unknown): s is CoreMatchStatus {
  return typeof s === 'string' && CORE.has(s);
}

/** ¿Está en juego? Solo el estado lo dice; nunca la hora. */
export function isLiveStatus(status: string | null | undefined): boolean {
  return status === 'live';
}

export interface StatusTransition {
  /** Estado resultante a persistir. */
  status: CoreMatchStatus;
  /** Si difiere del anterior (o es un alta). */
  changed: boolean;
  /**
   * La fuente desmiente un estado más avanzado (finished→live/scheduled,
   * live→scheduled). Se APLICA —las correcciones de la fuente son legítimas—
   * pero el llamante debe dejar rastro (logs/Sentry).
   */
  correction: boolean;
}

/** Orden de avance natural del partido (para detectar retrocesos). */
const PROGRESS: Record<CoreMatchStatus, number> = {
  scheduled: 0, postponed: 0, cancelled: 0, live: 1, finished: 2,
};

/**
 * Estado resultante de aplicar una observación de la fuente al estado actual.
 *
 * - Sin observación (o una que no es un estado conocido): se conserva el actual;
 *   un alta sin señal nace `scheduled`.
 * - Con observación explícita: se aplica. Si retrocede (`finished`→`live`,
 *   `live`→`scheduled`…), se marca como corrección.
 */
export function resolveStatusTransition(
  prev: string | null | undefined,
  observed: string | null | undefined,
): StatusTransition {
  const current = isCoreMatchStatus(prev) ? prev : null;

  if (!isCoreMatchStatus(observed)) {
    return current
      ? { status: current, changed: false, correction: false }
      : { status: 'scheduled', changed: true, correction: false };
  }

  if (!current) return { status: observed, changed: true, correction: false };
  if (current === observed) return { status: current, changed: false, correction: false };

  const goesBack = PROGRESS[observed] < PROGRESS[current]
    && observed !== 'postponed' && observed !== 'cancelled';
  return { status: observed, changed: true, correction: goesBack };
}

/**
 * Horas tras el saque a partir de las cuales un partido sin estado final se
 * considera "atrasado" (dato muerto) en la PRESENTACIÓN. Ya no se usa para
 * fabricar un `live`: solo distingue "pendiente de inicio" de "atrasado".
 */
export const OVERDUE_AFTER_HOURS = 5;

export type MatchDisplayState =
  | 'scheduled'       // aún no es la hora
  | 'awaiting_start'  // ya es la hora, la fuente todavía no lo da en juego
  | 'overdue'         // muy pasada la hora, sin resultado ni directo
  | 'live'
  | 'finished'
  | 'postponed'
  | 'cancelled';

/**
 * Estado a MOSTRAR. Única derivación permitida a partir de la hora: distinguir,
 * dentro de `scheduled`, si aún no es la hora, si la fuente se retrasa o si el
 * dato está muerto. Nunca devuelve `live` para un partido que no lo está.
 */
export function matchDisplayState(
  status: string,
  scheduledAt: Date | string | null | undefined,
  nowMs: number,
): MatchDisplayState {
  if (status === 'live' || status === 'finished' || status === 'postponed' || status === 'cancelled') {
    return status;
  }
  const startMs = scheduledAt ? new Date(scheduledAt).getTime() : NaN;
  if (!Number.isFinite(startMs) || nowMs < startMs) return 'scheduled';
  return nowMs - startMs < OVERDUE_AFTER_HOURS * 3_600_000 ? 'awaiting_start' : 'overdue';
}

// ── Estructura de competición ──
/**
 * Estructura de una competición — modelo y reglas ÚNICAS (scraper, ETL, API, web).
 *
 *   Competition → Season → Phase → (Group) → Round → Match
 *
 * - Una temporada tiene una o varias FASES, en orden (`ordinal`). El "formato" de
 *   la competición no existe como campo: es la secuencia de sus fases.
 * - `PhaseKind`: `league` (todos contra todos), `groups` (liguilla por grupos) o
 *   `knockout` (eliminatorias). `isPlacement` marca las fases que no deciden el
 *   título (playoff 9.º-10.º, puestos 5.º-8.º, consolación).
 * - En una fase `league`/`groups` las rondas son JORNADAS (`number`).
 * - En una `knockout` las rondas son FASES ELIMINATORIAS con `stage` canónico
 *   (cuartos, semis, final…) y cada partido lleva su nº dentro de la serie
 *   (`seriesGame`: "2 CUARTOS" → 2), no una ronda propia.
 *
 * Prioridad para decidir la estructura (de más a menos fiable):
 *   1. Datos explícitos de la fuente: bloques de fase (`content_fase_X` + su
 *      título) y cabeceras de ronda ("JORNADA 5", "2 CUARTOS", "SEMIFINALS").
 *   2. Metadatos estructurados declarados (competition_sources).
 *   3. Reglas deterministas (p. ej. una fase con solo dos equipos es una
 *      eliminatoria).
 *   4. Fallback explícito (`resolvedBy: 'fallback'`), nunca silencioso.
 *
 * Los parsers de etiquetas reconocen el VOCABULARIO de la fuente (es/ca/en/it/pt),
 * no nombres de competiciones concretas. Funciones puras y testeadas.
 */

export type PhaseKind = 'league' | 'groups' | 'knockout';
export const PHASE_KINDS: readonly PhaseKind[] = ['league', 'groups', 'knockout'];

export type KnockoutStage = 'round_of_16' | 'quarters' | 'semis' | 'final' | 'third_place' | 'placement';
export const KNOCKOUT_STAGES: readonly KnockoutStage[] = [
  'round_of_16', 'quarters', 'semis', 'final', 'third_place', 'placement',
];

/** Orden de presentación de las fases eliminatorias. */
export const STAGE_ORDER: Record<KnockoutStage, number> = {
  round_of_16: 1, quarters: 2, semis: 3, final: 4, third_place: 5, placement: 6,
};

export function isKnockoutStage(s: unknown): s is KnockoutStage {
  return typeof s === 'string' && (KNOCKOUT_STAGES as readonly string[]).includes(s);
}

export function isPhaseKind(s: unknown): s is PhaseKind {
  return typeof s === 'string' && (PHASE_KINDS as readonly string[]).includes(s);
}

/** De dónde sale la estructura (trazabilidad en `phases.resolved_by`). */
export type StructureEvidence = 'source_rounds' | 'source_title' | 'declared' | 'structural_rule' | 'fallback';

// ── Etiquetas de ronda ─────────────────────────────────────────────────────

export type RoundLabel =
  | { type: 'matchday'; number: number }
  | { type: 'stage'; stage: KnockoutStage; game: number | null }
  | { type: 'game'; game: number }
  | { type: 'ordinal'; number: number }
  | { type: 'unlabelled' };

function norm(raw: string | null | undefined): string {
  return (raw ?? '')
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .toUpperCase().replace(/\s+/g, ' ').trim();
}

/** Rango de puestos: "5TH - 8TH", "5 TO 6", "5º-8º", "9 Y 10". */
const PLACE_RANGE = /\b\d{1,2}\s*(?:º|ª|O|A|ST|ND|RD|TH)?\s*(?:-|–|TO|Y|I|E|AL|\/)\s*\d{1,2}\s*(?:º|ª|O|A|ST|ND|RD|TH)?\b/;

function stageOf(u: string): KnockoutStage | null {
  if (/\bFINAL\s*(?:FOUR|4|EIGHT|8)\b|\bF4\b/.test(u)) return null; // formato, no fase
  if (/OCTAVOS|VUITENS|OTTAVI|OITAVOS|HUITIEMES|ROUND OF 16|EIGHTH|\b1\/8\b/.test(u)) return 'round_of_16';
  if (/CUARTOS|QUARTS|QUARTER|QUARTI|QUARTOS|\b1\/4\b/.test(u)) return 'quarters';
  if (/SEMI|MEIAS?[- ]?FINA|\b1\/2\b/.test(u)) return 'semis';
  if (/BRON[CZ]E\s*MEDAL|SMALL\s*FINAL|FINALINA|3\s*(?:º|ER|RD|O)?\s*(?:Y|I|E|-|\/|AND)\s*4|TERCER|THIRD|3RD\s*PLACE/.test(u)) return 'third_place';
  if (/PUESTOS?|PLAZAS?|PLACE|POSITION|LLOCS?|POSTI|LUGARES?/.test(u) && PLACE_RANGE.test(u)) return 'placement';
  if (/^\d{1,2}\s*(?:º|ª)?\s*(?:TO|A|Y)\s*\d{1,2}\s*(?:º|ª)?$/.test(u)) return 'placement';
  if (/GOLD\s*MEDAL|\bFINALE?\b|\bFINALS?\b/.test(u)) return 'final';
  return null;
}

/**
 * Interpreta una cabecera de ronda de la fuente. Nunca adivina: lo que no
 * reconoce queda `unlabelled` (p. ej. las cabeceras de fecha de los torneos).
 */
export function parseRoundLabel(raw: string | null | undefined): RoundLabel {
  const u = norm(raw);
  if (!u) return { type: 'unlabelled' };

  // Las fases van antes que las jornadas: "ROUND OF 16" no es la jornada 16.
  // "2 CUARTOS" = partido 2 de los cuartos; "5 TO 6" es un rango de puestos.
  const gamePrefix = u.match(/^(\d{1,2})\s+(?=\D)/);
  const prefixedStage = gamePrefix ? stageOf(u.slice(gamePrefix[0].length)) : null;
  if (prefixedStage) return { type: 'stage', stage: prefixedStage, game: Number(gamePrefix![1]) };
  const stage = stageOf(u);
  if (stage) return { type: 'stage', stage, game: null };

  const md = u.match(/^(?:JORNADA|GIORNATA|JOURNEE|MATCHDAY|ROUND|J\.?)\s*N?[º.]?\s*(\d{1,3})\b/)
    ?? u.match(/^(\d{1,3})\s*[ªº]?\s*(?:JORNADA|GIORNATA|JOURNEE)\b/);
  if (md) return { type: 'matchday', number: Number(md[1]) };

  const game = u.match(/^(?:PARTIDO|PARTIT|PARTITA|JOGO|GAME|MATCH|LEG|MANGA)\s*(\d{1,2})$/)
    ?? u.match(/^(\d{1,2})\s*(?:ST|ND|RD|TH)?\s*LEG$/);
  if (game) return { type: 'game', game: Number(game[1]) };
  if (/^(?:IDA|ANADA|FIRST LEG|ANDATA)$/.test(u)) return { type: 'game', game: 1 };
  if (/^(?:VUELTA|TORNADA|SECOND LEG|RITORNO|VOLTA)$/.test(u)) return { type: 'game', game: 2 };

  if (/^\d{1,3}$/.test(u)) return { type: 'ordinal', number: Number(u) };
  return { type: 'unlabelled' };
}

// ── Títulos de fase ────────────────────────────────────────────────────────

export interface PhaseTitleInfo {
  kindHint: PhaseKind | null;
  isPlacement: boolean;
  /** Si el título nombra UN grupo ("GRUPO A"). */
  groupName: string | null;
}

export function parsePhaseTitle(raw: string | null | undefined): PhaseTitleInfo {
  const u = norm(raw);
  if (!u) return { kindHint: null, isPlacement: false, groupName: null };

  const isPlacement = PLACE_RANGE.test(u)
    || /PUESTOS|PLACE\b|POSITION|CONSOLACI|PLAY ?OUT|PERMANENCIA|DESCENSO/.test(u);
  const group = u.match(/\b(?:GRUPOS?|GRUPS?|GROUPS?|GRUPPO|GRUP)\s+([A-Z0-9]{1,2})$/);

  let kindHint: PhaseKind | null = null;
  if (group || /\bGRUPOS?\b|\bGRUPS?\b|\bGROUPS?\b|\bGRUPPO\b|\bGRUP\b/.test(u)) kindHint = 'groups';
  else if (/PLAY ?OFF|PLAY ?OUT|KNOCKOUT|FINAL (?:PHASE|STAGE)|FASES? FINALS?|ELIMINATORI|FINAL ?(?:FOUR|4|EIGHT|8)\b/.test(u)) kindHint = 'knockout';
  else if (/LIGA REGULAR|LLIGA REGULAR|FASE REGULAR|REGULAR SEASON|TEMPORADA REGULAR|LIGUILLA/.test(u)) kindHint = 'league';
  else if (isPlacement && /PLACE|POSITION|PUESTOS/.test(u)) kindHint = 'knockout';

  return { kindHint, isPlacement, groupName: group ? group[1]! : null };
}

// ── Tipo de fase ───────────────────────────────────────────────────────────

export interface PhaseEvidence {
  labels: RoundLabel[];
  title: PhaseTitleInfo;
  /** Hay grupos en los partidos o la clasificación de esta fase. */
  hasGroups: boolean;
  /** Equipos distintos vistos en la fase (0 = desconocido). */
  distinctTeams: number;
  /** Metadato declarado (competition_sources), si existe. */
  declaredKind?: PhaseKind | null;
}

export function resolvePhaseKind(e: PhaseEvidence): { kind: PhaseKind; resolvedBy: StructureEvidence } {
  const informative = e.labels.filter((l) => l.type !== 'unlabelled');
  // 1. Rondas de la fuente: una sola fase eliminatoria lo decide; si todas son jornadas, liguilla.
  if (informative.some((l) => l.type === 'stage')) return { kind: 'knockout', resolvedBy: 'source_rounds' };
  // Regla determinista que prevalece sobre la etiqueta: una "liga" de solo dos
  // equipos no existe — es una eliminatoria a doble partido que la fuente
  // rotula "Jornada 1" / "Jornada 2" (caso real idc 3515/3516).
  if (e.distinctTeams === 2 && informative.length > 0 && informative.every((l) => l.type === 'matchday')) {
    return { kind: 'knockout', resolvedBy: 'structural_rule' };
  }
  if (informative.length > 0 && informative.every((l) => l.type === 'matchday')) {
    return { kind: e.hasGroups || e.title.kindHint === 'groups' ? 'groups' : 'league', resolvedBy: 'source_rounds' };
  }
  // 2. Título de la fase.
  if (e.title.kindHint) {
    const kind = e.title.kindHint === 'league' && e.hasGroups ? 'groups' : e.title.kindHint;
    return { kind, resolvedBy: 'source_title' };
  }
  // 3. Metadato declarado.
  if (e.declaredKind) return { kind: e.declaredKind, resolvedBy: 'declared' };
  // 4. Reglas deterministas.
  if (e.distinctTeams === 2) return { kind: 'knockout', resolvedBy: 'structural_rule' };
  if (e.hasGroups) return { kind: 'groups', resolvedBy: 'structural_rule' };
  // 5. Fallback explícito.
  return { kind: 'league', resolvedBy: 'fallback' };
}

// ── Planificador de estructura ─────────────────────────────────────────────

/** Fila de calendario tal y como la ve la fuente (con o sin equipos publicados). */
export interface StructureRow {
  /** Id de fase en la fuente (`fep_fase_3483`). */
  phaseRef: string;
  phaseTitle: string | null;
  roundLabel: string | null;
  /** YYYYMMDD o ISO; null si la fuente no la da. */
  date: string | null;
  homeRef: string | null;
  awayRef: string | null;
  groupName: string | null;
  /** Orden en el documento de la fuente (desempate estable). */
  docIndex: number;
}

export interface PlannedRound {
  /** Clave estable dentro del plan (fase + ronda). */
  key: string;
  roundType: 'regular' | 'playoff';
  number: number;
  stage: KnockoutStage | null;
  name: string | null;
}

export interface PlannedPhase {
  ref: string;
  ordinal: number;
  kind: PhaseKind;
  isPlacement: boolean;
  name: string | null;
  resolvedBy: StructureEvidence;
  rounds: PlannedRound[];
}

export interface RowAssignment {
  phaseRef: string;
  roundKey: string;
  seriesGame: number | null;
  /** Grupo de la fila (de la propia fila o del título "GRUPO A" de su bloque). */
  groupName: string | null;
}

export interface StructurePlan {
  phases: PlannedPhase[];
  /** Una por fila de entrada, en el mismo orden. */
  assignments: RowAssignment[];
}

export interface PlanOptions {
  /** Tipo declarado (metadato) para fases cuya fuente no lo deja claro. */
  declaredKind?: PhaseKind | null;
}

function dateKey(d: string | null): string {
  if (!d) return '99999999';
  const digits = d.replace(/\D/g, '');
  return digits.slice(0, 8).padEnd(8, '9');
}

/** Etiqueta sin el prefijo de partido de serie ("2 CUARTOS" → "CUARTOS"). */
function baseLabel(raw: string | null): string {
  return (raw ?? '').replace(/^\s*\d{1,2}\s+(?=\D)/, '').replace(/\s+/g, ' ').trim();
}

/**
 * Convierte las filas de calendario de una competición (todas sus fases, de
 * uno o varios idc) en fases + rondas + asignación por fila. Mismo algoritmo
 * para cualquier formato: liga, liga+playoff, grupos, grupos+final four, final
 * four, eliminatoria.
 */
export function planSourceStructure(input: StructureRow[], opts: PlanOptions = {}): StructurePlan {
  // Bloques titulados "GRUPO A", "GRUPO B"… son grupos de UNA misma fase: se
  // funden en la fase del primero y el grupo pasa a cada fila.
  let groupsRef: string | null = null;
  const rows = input.map((row) => {
    const t = parsePhaseTitle(row.phaseTitle);
    if (!t.groupName) return row;
    groupsRef ??= row.phaseRef;
    return { ...row, phaseRef: groupsRef, phaseTitle: null, groupName: row.groupName ?? t.groupName };
  });

  // Agrupar por fase conservando el orden de aparición.
  const byPhase = new Map<string, { rows: Array<{ row: StructureRow; idx: number }> }>();
  rows.forEach((row, idx) => {
    const g = byPhase.get(row.phaseRef) ?? { rows: [] };
    g.rows.push({ row, idx });
    byPhase.set(row.phaseRef, g);
  });

  // Orden de fases: cronológico (primera fecha) y, a igualdad, el del documento.
  const ordered = [...byPhase.entries()].sort(([, a], [, b]) => {
    const da = a.rows.reduce((m, r) => (dateKey(r.row.date) < m ? dateKey(r.row.date) : m), '99999999');
    const db = b.rows.reduce((m, r) => (dateKey(r.row.date) < m ? dateKey(r.row.date) : m), '99999999');
    if (da !== db) return da < db ? -1 : 1;
    return a.rows[0]!.row.docIndex - b.rows[0]!.row.docIndex;
  });

  const assignments: RowAssignment[] = new Array(rows.length);
  const phases: PlannedPhase[] = [];

  ordered.forEach(([ref, group], i) => {
    const title = parsePhaseTitle(group.rows[0]!.row.phaseTitle);
    const labels = group.rows.map((r) => parseRoundLabel(r.row.roundLabel));
    const teams = new Set<string>();
    for (const { row } of group.rows) {
      if (row.homeRef) teams.add(row.homeRef);
      if (row.awayRef) teams.add(row.awayRef);
    }
    const hasGroups = group.rows.some((r) => !!r.row.groupName) || !!title.groupName;
    const { kind, resolvedBy } = resolvePhaseKind({
      labels, title, hasGroups, distinctTeams: teams.size, declaredKind: opts.declaredKind ?? null,
    });

    const rounds = new Map<string, PlannedRound>();
    const phaseName = group.rows[0]!.row.phaseTitle?.replace(/\s+/g, ' ').trim() || null;

    if (kind === 'knockout') {
      const sameStageCount = new Map<string, number>();
      group.rows.forEach(({ row, idx }, k) => {
        const label = labels[k]!;
        const stage: KnockoutStage | null = label.type === 'stage'
          ? label.stage
          : (title.isPlacement ? 'placement' : null);
        const game = label.type === 'stage' ? label.game
          : label.type === 'game' ? label.game
          : label.type === 'ordinal' || label.type === 'matchday' ? label.number
          : null;
        const base = label.type === 'stage' ? baseLabel(row.roundLabel) : '';
        const roundKey = `${ref}|ko|${stage ?? 'none'}|${norm(base)}`;
        if (!rounds.has(roundKey)) {
          const slot = stage ?? 'none';
          const n = sameStageCount.get(slot) ?? 0;
          sameStageCount.set(slot, n + 1);
          rounds.set(roundKey, {
            key: roundKey,
            roundType: 'playoff',
            number: (stage ? STAGE_ORDER[stage] : 9) * 10 + n,
            stage,
            name: base || phaseName,
          });
        }
        assignments[idx] = { phaseRef: ref, roundKey, seriesGame: game, groupName: row.groupName };
      });
    } else {
      // Liga / grupos: jornada explícita o, si la cabecera no la numera (fecha),
      // por orden cronológico de las cabeceras.
      const unnumbered = new Map<string, string>(); // etiqueta → primera fecha
      group.rows.forEach(({ row }, k) => {
        const l = labels[k]!;
        if (l.type !== 'matchday' && l.type !== 'ordinal') {
          const key = norm(row.roundLabel) || dateKey(row.date);
          const prev = unnumbered.get(key);
          if (!prev || dateKey(row.date) < prev) unnumbered.set(key, dateKey(row.date));
        }
      });
      const chrono = [...unnumbered.entries()].sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
      const chronoNumber = new Map(chrono.map(([k], j) => [k, j + 1]));

      group.rows.forEach(({ row, idx }, k) => {
        const l = labels[k]!;
        const number = l.type === 'matchday' || l.type === 'ordinal'
          ? l.number
          : chronoNumber.get(norm(row.roundLabel) || dateKey(row.date))!;
        const roundKey = `${ref}|md|${number}`;
        if (!rounds.has(roundKey)) {
          rounds.set(roundKey, {
            key: roundKey,
            roundType: 'regular',
            number,
            stage: null,
            name: l.type === 'matchday' ? (row.roundLabel ?? '').replace(/\s+/g, ' ').trim() : null,
          });
        }
        assignments[idx] = { phaseRef: ref, roundKey, seriesGame: null, groupName: row.groupName };
      });
    }

    phases.push({
      ref,
      ordinal: i + 1,
      kind,
      isPlacement: title.isPlacement,
      name: phaseName,
      resolvedBy,
      rounds: [...rounds.values()].sort((a, b) => a.number - b.number),
    });
  });

  return { phases, assignments };
}

// ── Compatibilidad con consumidores existentes ─────────────────────────────

/**
 * `roundNumber` legado de las eliminatorias que ya consumen la web y la app
 * (1=cuartos, 2=semis, 3=final, 0=colocación). Se calcula desde la fase
 * EXPLÍCITA, ya no por cronología.
 */
export function compatRoundNumber(stage: KnockoutStage | null, isPlacementPhase: boolean): number | null {
  if (isPlacementPhase || stage === 'placement') return 0;
  if (stage === 'quarters') return 1;
  if (stage === 'semis') return 2;
  if (stage === 'final') return 3;
  return null;
}

/** Formato legado (`competitionFormat`) derivado de las fases, para clientes antiguos. */
export function compatCompetitionFormat(
  phases: Array<{ kind: PhaseKind; isPlacement: boolean; stages: Array<KnockoutStage | null> }>,
): 'league' | 'bracket' | 'final_four' {
  const titlePhases = phases.filter((p) => !p.isPlacement);
  if (titlePhases.length === 0 || titlePhases.some((p) => p.kind !== 'knockout')) return 'league';
  return titlePhases.length === 1 && isFinalFourStages(titlePhases[0]!.stages) ? 'final_four' : 'bracket';
}

/** Una fase eliminatoria es "final four" si empieza en semifinales (semis → final [+ 3.º]). */
export function isFinalFourStages(stages: Array<KnockoutStage | null>): boolean {
  const s = new Set(stages.filter((x): x is KnockoutStage => x !== null));
  if (!s.has('semis')) return false;
  return [...s].every((x) => x === 'semis' || x === 'final' || x === 'third_place');
}
export * from './standings-zones.js';
