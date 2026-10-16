import { describe, it, expect } from 'vitest';
import { buildMatchDetail } from './match-dto.js';
import type { MatchDtoRow, MatchDtoEventRow, MatchLineupRow } from './match-dto.js';

/**
 * Paridad REST ↔ SSE (#283): REST (`GET /matches/:id`) y el snapshot/update del
 * stream (`GET /matches/:id/stream`) deben construir EXACTAMENTE el mismo DTO.
 * Este test fija los campos que el snapshot pérdida antes: competición, cronos
 * (`clock`) y stats completas (goles, azules, tiempos muertos...).
 */

function row(over: Partial<MatchDtoRow> = {}): MatchDtoRow {
  return {
    id: 'm1',
    season_id: 's1',
    round_id: 'r1',
    home_score: 3,
    away_score: 2,
    home_goals_reg: null,
    away_goals_reg: null,
    home_pen: null,
    away_pen: null,
    win_type: null,
    winner_team_id: null,
    penalty_shootout: null,
    home_fouls: 4,
    away_fouls: 5,
    status: 'live',
    event_coverage: 'full',
    scheduled_at: new Date('2026-09-27T18:00:00.000Z'),
    started_at: new Date('2026-09-27T18:02:00.000Z'),
    finished_at: null,
    venue_name: null,
    venue_city: null,
    referee: null,
    source_ref: 'src-1',
    video_url: null,
    home_team_id: 'ht',
    home_team_name: 'Local',
    home_team_short_name: 'LOC',
    home_team_logo_url: null,
    away_team_id: 'at',
    away_team_name: 'Visitante',
    away_team_short_name: 'VIS',
    away_team_logo_url: null,
    competition_id: 'c1',
    competition_name: 'Liga',
    competition_slug: 'liga',
    competition_timezone: 'Europe/Madrid',
    live_period: 2,
    live_clock_seconds: 750,
    live_clock_at: new Date('2026-09-27T18:30:00.000Z'),
    live_is_halftime: false,
    ...over,
  };
}

function event(over: Partial<MatchDtoEventRow> = {}): MatchDtoEventRow {
  return {
    id: 'e1',
    event_type: 'goal',
    minute: 12,
    period: 1,
    clock: '13:00',
    team_id: 'ht',
    detail: null,
    player_id: 'p1',
    player_first_name: 'Juan',
    player_last_name: 'Pérez',
    ...over,
  };
}

function lineup(over: Partial<MatchLineupRow> = {}): MatchLineupRow {
  return {
    is_home: true,
    jersey_number: 9,
    player_name: 'Juan Pérez',
    is_goalkeeper: false,
    is_starter: true,
    is_captain: false,
    goals: 2,
    assists: 1,
    player_id: 'p1',
    photo_url: null,
    ...over,
  };
}

describe('buildMatchDetail — paridad REST/SSE (#283)', () => {
  it('incluye la competición completa, no sólo id/name', () => {
    const { match } = buildMatchDetail(row(), [], []);
    expect(match.competitionId).toBe('c1');
    expect(match.competitionName).toBe('Liga');
    expect(match.competitionSlug).toBe('liga');
    expect(match.competitionTimezone).toBe('Europe/Madrid');
  });

  it('expone el estado efectivo y el desglose de resultado', () => {
    const { match } = buildMatchDetail(row({
      status: 'finished',
      event_coverage: 'partial',
      win_type: 'overtime',
      winner_team_id: 'ht',
      home_goals_reg: 3,
      away_goals_reg: 2,
      home_pen: null,
      away_pen: null,
    }), [], []);
    expect(match.status).toBe('finished');
    expect(match.eventCoverage).toBe('partial');
    expect(match.winType).toBe('overtime');
    expect(match.winnerTeamId).toBe('ht');
    expect(match.regulation).toEqual({ home: 3, away: 2 });
    expect(match.penalties).toBeNull();
  });

  it('normaliza fechas a ISO y expone el crono en vivo con clockAt ISO', () => {
    const { match } = buildMatchDetail(row(), [], []);
    expect(match.scheduledAt).toBe('2026-09-27T18:00:00.000Z');
    expect(match.startedAt).toBe('2026-09-27T18:02:00.000Z');
    expect(match.live).toEqual({
      period: 2,
      clockSeconds: 750,
      clockAt: '2026-09-27T18:30:00.000Z',
      isHalftime: false,
    });
  });

  it('acepta fechas ya serializadas (string) además de Date', () => {
    const { match } = buildMatchDetail(row({
      scheduled_at: '2026-09-27T18:00:00.000Z',
      started_at: null,
      live_clock_at: '2026-09-27T18:30:00.000Z',
    }), [], []);
    expect(match.scheduledAt).toBe('2026-09-27T18:00:00.000Z');
    expect(match.startedAt).toBeNull();
    expect(match.live?.clockAt).toBe('2026-09-27T18:30:00.000Z');
  });

  it('un partido programado (saque futuro) no expone live', () => {
    const { match } = buildMatchDetail(row({
      status: 'scheduled',
      scheduled_at: new Date(Date.now() + 3 * 3_600_000),
      started_at: null,
      live_period: null,
      live_clock_seconds: null,
      live_clock_at: null,
    }), [], []);
    expect(match.status).toBe('scheduled');
    expect(match.live).toBeNull();
  });

  it('saque PASADO sin señal de la fuente → sigue programado: la hora no hace LIVE', () => {
    // Previsto hace 10 min (empieza tarde): ni la API ni el SSE lo dan en juego.
    const { match } = buildMatchDetail(row({
      status: 'scheduled',
      scheduled_at: new Date(Date.now() - 10 * 60_000),
      started_at: null,
    }), [], []);
    expect(match.status).toBe('scheduled');
    expect(match.live).toBeNull();
  });

  it('LIVE de la fuente aunque la hora prevista sea futura (la fuente manda)', () => {
    const { match } = buildMatchDetail(row({ status: 'live', scheduled_at: new Date(Date.now() + 3_600_000) }), [], []);
    expect(match.status).toBe('live');
    expect(match.live).not.toBeNull();
  });

  it('los eventos conservan el clock y el jugador', () => {
    const { events } = buildMatchDetail(row(), [event()], []);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      id: 'e1',
      eventType: 'goal',
      clock: '13:00',
      teamId: 'ht',
      isHomeTeam: true,
      player: { id: 'p1', firstName: 'Juan', lastName: 'Pérez' },
    });
  });

  it('evento sin jugador → player null y clock null si no viene', () => {
    const { events } = buildMatchDetail(row(), [event({ clock: null, player_id: null })], []);
    expect(events[0]!.player).toBeNull();
    expect(events[0]!.clock).toBeNull();
  });
});

describe('buildMatchDetail — stats completas (#283)', () => {
  it('cuenta goles, azules, rojas, tiempos muertos, faltas y penaltis', () => {
    const events: MatchDtoEventRow[] = [
      event({ id: 'g1', event_type: 'goal', team_id: 'ht' }),
      event({ id: 'g2', event_type: 'goal', team_id: 'at' }),
      event({ id: 'b1', event_type: 'blue_card', team_id: 'at' }),
      event({ id: 'r1', event_type: 'red_card', team_id: 'ht' }),
      event({ id: 't1', event_type: 'timeout', team_id: 'ht' }),
      event({ id: 'f1', event_type: 'foul', team_id: 'ht' }),
      event({ id: 'f2', event_type: 'foul', team_id: 'ht' }),
      event({ id: 'p1', event_type: 'penalty', team_id: 'ht', detail: 'gol de penalti' }),
      event({ id: 'p2', event_type: 'penalty', team_id: 'at', detail: 'fallado' }),
    ];
    const { stats } = buildMatchDetail(row({ home_score: 3, away_score: 2 }), events, []);

    expect(stats.homeGoals).toBe(3);
    expect(stats.awayGoals).toBe(2);
    expect(stats.homeBlueCards).toBe(0);
    expect(stats.awayBlueCards).toBe(1);
    expect(stats.homeRedCards).toBe(1);
    expect(stats.awayRedCards).toBe(0);
    expect(stats.homeTimeouts).toBe(1);
    expect(stats.awayTimeouts).toBe(0);
    expect(stats.homeFouls).toBe(2);
    expect(stats.awayFouls).toBe(5); // sin eventos 'foul' visitante → cabecera
    expect(stats.homePenalties).toEqual({ total: 1, scored: 1 });
    expect(stats.awayPenalties).toEqual({ total: 1, scored: 0 });
  });

  it('cae al marcador contado por eventos si no hay home_score', () => {
    const events: MatchDtoEventRow[] = [
      event({ id: 'g1', event_type: 'goal', team_id: 'ht' }),
      event({ id: 'g2', event_type: 'goal', team_id: 'ht' }),
      event({ id: 'g3', event_type: 'goal', team_id: 'at' }),
    ];
    const { stats } = buildMatchDetail(row({ home_score: null, away_score: null }), events, []);
    expect(stats.homeGoals).toBe(2);
    expect(stats.awayGoals).toBe(1);
  });

  it('agrega asistencias desde las alineaciones y faltas directas', () => {
    const events: MatchDtoEventRow[] = [
      event({ id: 'd1', event_type: 'direct_foul', team_id: 'ht', detail: 'falta marcada' }),
      event({ id: 'd2', event_type: 'direct_foul', team_id: 'ht', detail: 'falta fallada' }),
      event({ id: 'd3', event_type: 'direct_foul', team_id: 'at', detail: 'marcada' }),
    ];
    const lineups: MatchLineupRow[] = [
      lineup({ is_home: true, assists: 2 }),
      lineup({ is_home: true, assists: 1 }),
      lineup({ is_home: false, assists: 3 }),
    ];
    const { stats } = buildMatchDetail(row(), events, lineups);
    expect(stats.homeAssists).toBe(3);
    expect(stats.awayAssists).toBe(3);
    expect(stats.homeDirectFouls).toEqual({ total: 2, scored: 1 });
    expect(stats.awayDirectFouls).toEqual({ total: 1, scored: 1 });
  });

  it('las alineaciones se reparten por equipo conservando todos los campos', () => {
    const { lineups } = buildMatchDetail(row(), [], [
      lineup({ is_home: true, player_id: 'h1' }),
      lineup({ is_home: false, player_id: 'a1' }),
    ]);
    expect(lineups.home).toHaveLength(1);
    expect(lineups.away).toHaveLength(1);
    expect(lineups.home[0]).toMatchObject({
      jerseyNumber: 9,
      playerName: 'Juan Pérez',
      isStarter: true,
      goals: 2,
      assists: 1,
      playerId: 'h1',
    });
  });
});

describe('buildMatchDetail — ronda y fase del partido (spec 2026-10-16)', () => {
  it('una semifinal expone su ronda con la fase de la fuente', () => {
    const dto = buildMatchDetail(row({
      round_name: 'Semifinal', round_number: 95, round_type: 'playoff', round_stage: 'semis',
      group_name: null, series_game: null, phase_kind: 'knockout',
    }), [], []);
    expect(dto.match.round).toEqual({
      name: 'Semifinal', number: 95, type: 'playoff', stage: 'semis',
      groupName: null, seriesGame: null, phaseKind: 'knockout',
    });
  });

  it('un partido de grupos lleva su grupo y su jornada', () => {
    const dto = buildMatchDetail(row({
      round_name: 'Jornada 2', round_number: 2, round_type: 'regular', round_stage: null,
      group_name: 'A', series_game: null, phase_kind: 'groups',
    }), [], []);
    expect(dto.match.round).toMatchObject({ type: 'regular', number: 2, groupName: 'A', phaseKind: 'groups' });
  });

  it('sin ronda (partido suelto o fila antigua) → round null', () => {
    expect(buildMatchDetail(row(), [], []).match.round).toBeNull();
  });
});
