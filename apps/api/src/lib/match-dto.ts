/**
 * Mapper ÚNICO del detalle de partido, compartido por REST (`GET /matches/:id`)
 * y SSE (`GET /matches/:id/stream`, eventos `snapshot`/`update`).
 *
 * Antes cada ruta construía su propia versión y divergían: el snapshot SSE
 * perdía competición, cronos y la mayoría de stats, así que durante el directo
 * la pestaña de Estadísticas pintaba 0 goles y desaparecía el enlace a la
 * competición (#283). Aquí vive la construcción pura del DTO; las rutas sólo
 * aportan las filas de la BD.
 *
 * Sin I/O ni relojes: se puede testear aislada (ver `match-dto.test.ts`).
 */
import { isLiveStatus } from '@sports/shared-types';

export interface PenaltyShootout {
  home: { player: string; scored: boolean }[];
  away: { player: string; scored: boolean }[];
}

/** Fila de cabecera del partido (columnas que necesita el mapper). */
export interface MatchDtoRow {
  id: string;
  season_id: string;
  round_id: string | null;
  home_score: number | null;
  away_score: number | null;
  home_goals_reg: number | null;
  away_goals_reg: number | null;
  home_pen: number | null;
  away_pen: number | null;
  win_type: string | null;
  winner_team_id: string | null;
  penalty_shootout: PenaltyShootout | null;
  home_fouls: number | null;
  away_fouls: number | null;
  status: string;
  event_coverage: string;
  scheduled_at: Date | string | null;
  started_at: Date | string | null;
  finished_at: Date | string | null;
  venue_name: string | null;
  venue_city: string | null;
  referee: string | null;
  source_ref: string | null;
  video_url: string | null;
  home_team_id: string;
  home_team_name: string;
  home_team_short_name: string | null;
  home_team_logo_url: string | null;
  away_team_id: string;
  away_team_name: string;
  away_team_short_name: string | null;
  away_team_logo_url: string | null;
  competition_id: string | null;
  competition_name: string | null;
  competition_slug: string | null;
  competition_timezone: string | null;
  live_period: number | null;
  live_clock_seconds: number | null;
  live_clock_at: Date | string | null;
  live_is_halftime: boolean;
  // Ronda y fase (spec 2026-10-16). Opcionales: filas sin ronda o consultas
  // antiguas no las traen.
  round_name?: string | null;
  round_number?: number | null;
  round_type?: string | null;
  round_stage?: string | null;
  group_name?: string | null;
  series_game?: number | null;
  phase_kind?: string | null;
}

/** Ronda del partido para la ficha: «Semifinal», «Grupo A · Jornada 2»… */
export interface MatchDtoRound {
  name: string | null;
  number: number | null;
  /** regular | playoff | cup | friendly */
  type: string | null;
  /** Fase eliminatoria explícita de la fuente (quarters, semis, final…). */
  stage: string | null;
  /** Grupo en la fase de grupos ("A", "B"…). */
  groupName: string | null;
  /** Nº de partido de la serie ("2 CUARTOS" → 2). */
  seriesGame: number | null;
  /** league | groups | knockout */
  phaseKind: string | null;
}

/** Fila de evento (match_events + jugador). */
export interface MatchDtoEventRow {
  id: string;
  event_type: string;
  minute: number | null;
  period: number | null;
  clock?: string | null;
  team_id: string | null;
  detail: string | null;
  player_id: string | null;
  player_first_name: string | null;
  player_last_name: string | null;
}

/** Fila de alineación (match_lineups + foto del jugador). */
export interface MatchLineupRow {
  is_home: boolean;
  jersey_number: number | null;
  player_name: string;
  is_goalkeeper: boolean;
  is_starter: boolean;
  is_captain: boolean;
  goals: number;
  assists: number;
  player_id: string | null;
  photo_url: string | null;
}

export interface MatchDtoEvent {
  id: string;
  eventType: string;
  minute: number | null;
  period: number | null;
  clock: string | null;
  teamId: string | null;
  isHomeTeam: boolean;
  detail: string | null;
  player: { id: string; firstName: string; lastName: string } | null;
}

export interface MatchDtoLineup {
  jerseyNumber: number | null;
  playerName: string;
  isGoalkeeper: boolean;
  isStarter: boolean;
  isCaptain: boolean;
  goals: number;
  assists: number;
  playerId: string | null;
  photoUrl: string | null;
}

export interface MatchDtoStats {
  homeFouls: number;
  awayFouls: number;
  homeGoals: number;
  awayGoals: number;
  homeAssists: number;
  awayAssists: number;
  homeBlueCards: number;
  awayBlueCards: number;
  homeRedCards: number;
  awayRedCards: number;
  homeTimeouts: number;
  awayTimeouts: number;
  homeDirectFouls: { total: number; scored: number };
  awayDirectFouls: { total: number; scored: number };
  homePenalties: { total: number; scored: number };
  awayPenalties: { total: number; scored: number };
}

export interface MatchDto {
  match: {
    id: string;
    seasonId: string;
    roundId: string | null;
    competitionId: string | null;
    competitionName: string | null;
    competitionSlug: string | null;
    competitionTimezone: string | null;
    status: string;
    eventCoverage: string;
    scheduledAt: string | null;
    startedAt: string | null;
    finishedAt: string | null;
    score: { home: number | null; away: number | null };
    winType: string | null;
    winnerTeamId: string | null;
    regulation: { home: number | null; away: number | null } | null;
    penalties: { home: number | null; away: number | null } | null;
    penaltyShootout: PenaltyShootout | null;
    venue: { name: string; city: string | null } | null;
    referee: string | null;
    sourceRef: string | null;
    videoUrl: string | null;
    live: { period: number | null; clockSeconds: number | null; clockAt: string | null; isHalftime: boolean } | null;
    /** Ronda y fase del partido, o null si no pertenece a ninguna ronda. */
    round: MatchDtoRound | null;
    homeTeam: { id: string; name: string; shortName: string | null; logoUrl: string | null };
    awayTeam: { id: string; name: string; shortName: string | null; logoUrl: string | null };
  };
  events: MatchDtoEvent[];
  stats: MatchDtoStats;
  lineups: { home: MatchDtoLineup[]; away: MatchDtoLineup[] };
}

/** Ronda del partido o null si la fila no trae ninguna (partido suelto). */
export function buildMatchRound(row: MatchDtoRow): MatchDtoRound | null {
  if (row.round_name == null && row.round_number == null && row.round_type == null) return null;
  return {
    name:       row.round_name ?? null,
    number:     row.round_number ?? null,
    type:       row.round_type ?? null,
    stage:      row.round_stage ?? null,
    groupName:  row.group_name ?? null,
    seriesGame: row.series_game ?? null,
    phaseKind:  row.phase_kind ?? null,
  };
}

/** Normaliza a ISO cualquier timestamp que Postgres devuelva como Date o string. */
function toIso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : value;
}

/** Mapea las filas de eventos al DTO, marcando el lado y resolviendo el jugador. */
export function buildMatchEvents(rows: MatchDtoEventRow[], homeTeamId: string): MatchDtoEvent[] {
  return rows.map((e) => ({
    id: e.id,
    eventType: e.event_type,
    minute: e.minute,
    period: e.period,
    clock: e.clock ?? null,
    teamId: e.team_id,
    isHomeTeam: e.team_id === homeTeamId,
    detail: e.detail,
    player: e.player_id
      ? { id: e.player_id, firstName: e.player_first_name ?? '', lastName: e.player_last_name ?? '' }
      : null,
  }));
}

/** Reparte las alineaciones por equipo. */
export function buildLineups(rows: MatchLineupRow[]): { home: MatchDtoLineup[]; away: MatchDtoLineup[] } {
  const toLineup = (r: MatchLineupRow): MatchDtoLineup => ({
    jerseyNumber: r.jersey_number,
    playerName: r.player_name,
    isGoalkeeper: r.is_goalkeeper,
    isStarter: r.is_starter,
    isCaptain: r.is_captain,
    goals: r.goals,
    assists: r.assists,
    playerId: r.player_id,
    photoUrl: r.photo_url,
  });
  return {
    home: rows.filter((r) => r.is_home).map(toLineup),
    away: rows.filter((r) => !r.is_home).map(toLineup),
  };
}

/**
 * Stats derivadas de eventos y alineaciones.
 *
 * Faltas de equipo = nº de eventos `foul` por equipo (coincide con el contador
 * acumulado del acta). Fallback a la cabecera (`home_fouls`) sólo para partidos
 * antiguos sin eventos de falta. Goles: marcador oficial; si falta, conteo.
 */
export function buildMatchStats(
  events: MatchDtoEvent[],
  row: Pick<MatchDtoRow, 'home_score' | 'away_score' | 'home_fouls' | 'away_fouls'>,
  lineupRows: MatchLineupRow[],
): MatchDtoStats {
  const homeFouls = events.filter((e) => e.eventType === 'foul' && e.isHomeTeam).length
    || (row.home_fouls ?? 0);
  const awayFouls = events.filter((e) => e.eventType === 'foul' && !e.isHomeTeam && e.teamId !== null).length
    || (row.away_fouls ?? 0);

  const homePenalties = events.filter((e) => e.eventType === 'penalty' && e.isHomeTeam);
  const awayPenalties = events.filter((e) => e.eventType === 'penalty' && !e.isHomeTeam && e.teamId !== null);

  const penaltyScored = (list: MatchDtoEvent[]) =>
    list.filter((e) => e.detail?.toLowerCase().includes('gol') || e.detail?.toLowerCase().includes('marcado')).length;

  const countBy = (type: string, home: boolean) =>
    events.filter((e) => e.eventType === type && e.isHomeTeam === home && (home || e.teamId !== null)).length;

  const directFouls = (home: boolean) => {
    const list = events.filter((e) => e.eventType === 'direct_foul' && e.isHomeTeam === home && (home || e.teamId !== null));
    return {
      total:  list.length,
      scored: list.filter((e) => e.detail?.includes('marcada')).length,
    };
  };

  const sumLineup = (home: boolean, field: 'goals' | 'assists') =>
    lineupRows.filter((r) => r.is_home === home).reduce((acc, r) => acc + (r[field] ?? 0), 0);

  return {
    homeFouls,
    awayFouls,
    homeGoals: row.home_score ?? countBy('goal', true),
    awayGoals: row.away_score ?? countBy('goal', false),
    homeAssists: sumLineup(true, 'assists'),
    awayAssists: sumLineup(false, 'assists'),
    homeBlueCards: countBy('blue_card', true),
    awayBlueCards: countBy('blue_card', false),
    homeRedCards: countBy('red_card', true),
    awayRedCards: countBy('red_card', false),
    homeTimeouts: countBy('timeout', true),
    awayTimeouts: countBy('timeout', false),
    homeDirectFouls: directFouls(true),
    awayDirectFouls: directFouls(false),
    homePenalties: { total: homePenalties.length, scored: penaltyScored(homePenalties) },
    awayPenalties: { total: awayPenalties.length, scored: penaltyScored(awayPenalties) },
  };
}

/** Construye el DTO completo del partido (cabecera + eventos + stats + alineaciones). */
export function buildMatchDetail(
  row: MatchDtoRow,
  eventRows: MatchDtoEventRow[],
  lineupRows: MatchLineupRow[],
): MatchDto {
  const homeTeamId = row.home_team_id;

  // Estado expuesto = el de la BD, que solo pone `live` con señal explícita de
  // la fuente. La API ya no "adelanta" a live por la hora (#150 quedó resuelto
  // de raíz): un partido que empieza tarde no se pinta EN VIVO antes de tiempo.
  const status = row.status;

  const events = buildMatchEvents(eventRows, homeTeamId);
  const lineups = buildLineups(lineupRows);
  const stats = buildMatchStats(events, row, lineupRows);

  const match: MatchDto['match'] = {
    id:          row.id,
    seasonId:    row.season_id,
    roundId:     row.round_id,
    competitionId:   row.competition_id,
    competitionName: row.competition_name,
    competitionSlug: row.competition_slug,
    competitionTimezone: row.competition_timezone,
    status,
    eventCoverage: row.event_coverage,
    scheduledAt: toIso(row.scheduled_at),
    startedAt:   toIso(row.started_at),
    finishedAt:  toIso(row.finished_at),
    score: { home: row.home_score, away: row.away_score },
    // Desglose prórroga/penaltis (null en partidos normales).
    winType:      row.win_type,
    winnerTeamId: row.winner_team_id,
    regulation:   (row.home_goals_reg != null || row.away_goals_reg != null)
      ? { home: row.home_goals_reg, away: row.away_goals_reg } : null,
    penalties:    (row.home_pen != null || row.away_pen != null)
      ? { home: row.home_pen, away: row.away_pen } : null,
    penaltyShootout: row.penalty_shootout ?? null,
    venue: row.venue_name ? { name: row.venue_name, city: row.venue_city } : null,
    referee:     row.referee,
    sourceRef:   row.source_ref,
    videoUrl:    row.video_url,
    live: isLiveStatus(status)
      ? {
          period:       row.live_period,
          clockSeconds: row.live_clock_seconds,
          clockAt:      toIso(row.live_clock_at),
          isHalftime:   row.live_is_halftime,
        }
      : null,
    round: buildMatchRound(row),
    homeTeam: {
      id:        row.home_team_id,
      name:      row.home_team_name,
      shortName: row.home_team_short_name,
      logoUrl:   row.home_team_logo_url,
    },
    awayTeam: {
      id:        row.away_team_id,
      name:      row.away_team_name,
      shortName: row.away_team_short_name,
      logoUrl:   row.away_team_logo_url,
    },
  };

  return { match, events, stats, lineups };
}
