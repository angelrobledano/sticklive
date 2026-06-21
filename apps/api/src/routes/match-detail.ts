import { Hono } from 'hono';
import { db } from '@sports/db';

export const matchDetailRouter = new Hono();

interface MatchDetailRow {
  id: string;
  season_id: string;
  round_id: string | null;
  home_score: number | null;
  away_score: number | null;
  home_fouls: number | null;
  away_fouls: number | null;
  status: string;
  scheduled_at: Date | null;
  started_at: Date | null;
  finished_at: Date | null;
  venue_name: string | null;
  venue_city: string | null;
  referee: string | null;
  source_ref: string | null;
  home_team_id: string;
  home_team_name: string;
  home_team_short_name: string | null;
  home_team_logo_url: string | null;
  away_team_id: string;
  away_team_name: string;
  away_team_short_name: string | null;
  away_team_logo_url: string | null;
  live_period: number | null;
  live_clock_seconds: number | null;
  live_clock_at: Date | null;
  live_is_halftime: boolean;
}

interface EventRow {
  id: string;
  event_type: string;
  minute: number | null;
  period: number | null;
  team_id: string | null;
  detail: string | null;
  player_id: string | null;
  player_first_name: string | null;
  player_last_name: string | null;
}

/**
 * GET /matches/:id
 * Devuelve el detalle completo de un partido: cabecera, eventos ordenados y stats derivadas.
 */
matchDetailRouter.get('/:id', async (c) => {
  const id = c.req.param('id');

  try {
    // 1) Cabecera del partido
    const matchResult = await db.query<MatchDetailRow>(`
      SELECT
        m.id, m.season_id, m.round_id,
        m.home_score, m.away_score, m.home_fouls, m.away_fouls, m.status,
        m.scheduled_at, m.started_at, m.finished_at,
        m.venue_name, m.venue_city, m.referee, m.source_ref,
        m.live_period, m.live_clock_seconds, m.live_clock_at, m.live_is_halftime,
        ht.id           AS home_team_id,
        ht.name         AS home_team_name,
        ht.short_name   AS home_team_short_name,
        ht.logo_url     AS home_team_logo_url,
        at.id           AS away_team_id,
        at.name         AS away_team_name,
        at.short_name   AS away_team_short_name,
        at.logo_url     AS away_team_logo_url
      FROM matches m
      LEFT JOIN teams ht ON ht.id = m.home_team_id
      LEFT JOIN teams at ON at.id = m.away_team_id
      WHERE m.id = $1
    `, [id]);

    if (matchResult.rows.length === 0) {
      return c.json({ error: 'Match not found' }, 404);
    }

    const row = matchResult.rows[0]!;  // guarda rows.length === 0 lo asegura

    // Forzar status live si scheduled_at ya paso y el partido no ha terminado/aplazado.
    // Cubre el gap entre cuando el partido empieza en el mundo real y cuando
    // el scraper de marcadores actualiza la fila en DB (hasta ~1 minuto de lag).
    const nowMs = Date.now();
    const startMs = row.scheduled_at ? (row.scheduled_at as Date).getTime() : null;
    const terminalStatuses = new Set(['finished', 'postponed', 'cancelled']);
    const effectiveStatus: string = terminalStatuses.has(row.status)
      ? row.status
      : (row.status === 'live' || (startMs !== null && nowMs >= startMs))
        ? 'live'
        : row.status;

    // 2) Eventos del partido ordenados cronológicamente
    const eventsResult = await db.query<EventRow>(`
      SELECT
        e.id, e.event_type, e.minute, e.period, e.clock,
        e.team_id, e.detail,
        e.player_id,
        p.first_name  AS player_first_name,
        p.last_name   AS player_last_name
      FROM match_events e
      LEFT JOIN players p ON p.id = e.player_id
      WHERE e.match_id = $1
      ORDER BY
        COALESCE(e.period, 99) ASC,
        COALESCE(e.minute, 9999) ASC,
        e.created_at ASC
    `, [id]);

    const homeTeamId = row.home_team_id;

    const events = eventsResult.rows.map((e) => ({
      id:          e.id,
      eventType:   e.event_type,
      minute:      e.minute,
      period:      e.period,
      clock:       (e as unknown as { clock: string | null }).clock,
      teamId:      e.team_id,
      isHomeTeam:  e.team_id === homeTeamId,
      detail:      e.detail,
      player:      e.player_id
        ? { id: e.player_id, firstName: e.player_first_name ?? '', lastName: e.player_last_name ?? '' }
        : null,
    }));

    // 2b) Alineaciones (si el scraper de ficha las ha cargado)
    const lineupsResult = await db.query<{
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
    }>(`
      SELECT ml.is_home, ml.jersey_number, ml.player_name, ml.player_id,
             ml.is_goalkeeper, ml.is_starter, ml.is_captain, ml.goals, ml.assists,
             p.photo_url
      FROM match_lineups ml
      LEFT JOIN players p ON p.id = ml.player_id
      WHERE ml.match_id = $1
        AND ml.role IS NULL  -- jugadores; el cuerpo técnico se muestra en la ficha de equipo
      ORDER BY ml.is_home DESC, ml.is_starter DESC, ml.jersey_number ASC NULLS LAST
    `, [id]);

    const toLineup = (r: typeof lineupsResult.rows[number]) => ({
      jerseyNumber: r.jersey_number,
      playerName:   r.player_name,
      isGoalkeeper: r.is_goalkeeper,
      isStarter:    r.is_starter,
      isCaptain:    r.is_captain,
      goals:        r.goals,
      assists:      r.assists,
      playerId:     r.player_id,
      photoUrl:     r.photo_url,
    });
    const lineups = {
      home: lineupsResult.rows.filter((r) => r.is_home).map(toLineup),
      away: lineupsResult.rows.filter((r) => !r.is_home).map(toLineup),
    };

    // 3) Stats: faltas de equipo desde matches.home_fouls/away_fouls
    // (scrapeadas de la cabecera de la ficha). Fallback legacy: contar
    // tarjetas azules, que NO es lo mismo pero es mejor que nada.
    const homeFouls = row.home_fouls
      ?? events.filter((e) => e.eventType === 'blue_card' && e.isHomeTeam).length;
    const awayFouls = row.away_fouls
      ?? events.filter((e) => e.eventType === 'blue_card' && !e.isHomeTeam && e.teamId !== null).length;

    const homePenalties = events.filter((e) => e.eventType === 'penalty' && e.isHomeTeam);
    const awayPenalties = events.filter((e) => e.eventType === 'penalty' && !e.isHomeTeam && e.teamId !== null);

    const penaltyScored = (list: typeof events) =>
      list.filter((e) => e.detail?.toLowerCase().includes('gol') || e.detail?.toLowerCase().includes('marcado')).length;

    // Conteos por tipo de evento y lado
    const countBy = (type: string, home: boolean) =>
      events.filter((e) => e.eventType === type && e.isHomeTeam === home && (home || e.teamId !== null)).length;

    // Faltas directas: detail termina en 'marcada' / 'fallada'
    const directFouls = (home: boolean) => {
      const list = events.filter((e) => e.eventType === 'direct_foul' && e.isHomeTeam === home && (home || e.teamId !== null));
      return {
        total:  list.length,
        scored: list.filter((e) => e.detail?.includes('marcada')).length,
      };
    };

    const sumLineup = (home: boolean, field: 'goals' | 'assists') =>
      lineupsResult.rows.filter((r) => r.is_home === home).reduce((acc, r) => acc + (r[field] ?? 0), 0);

    const stats = {
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
      homePenalties: {
        total:  homePenalties.length,
        scored: penaltyScored(homePenalties),
      },
      awayPenalties: {
        total:  awayPenalties.length,
        scored: penaltyScored(awayPenalties),
      },
    };

    const match = {
      id:          row.id,
      seasonId:    row.season_id,
      roundId:     row.round_id,
      status:      effectiveStatus,
      scheduledAt: row.scheduled_at?.toISOString() ?? null,
      startedAt:   row.started_at?.toISOString()   ?? null,
      finishedAt:  row.finished_at?.toISOString()  ?? null,
      score: { home: row.home_score, away: row.away_score },
      venue: row.venue_name ? { name: row.venue_name, city: row.venue_city } : null,
      referee:     row.referee,
      sourceRef:   row.source_ref,
      live: (effectiveStatus === 'live')
        ? {
            period:       row.live_period,
            clockSeconds: row.live_clock_seconds,
            clockAt:      row.live_clock_at?.toISOString() ?? null,
            isHalftime:   row.live_is_halftime,
          }
        : null,
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

    // DIAG: imprimir resumen de la respuesta en la terminal del servidor
    console.log('[match-detail] RESPONSE for', id, {
      matchStatus:    match.status,
      matchId:        match.id,
      homeTeam:       match.homeTeam?.name,
      awayTeam:       match.awayTeam?.name,
      score:          match.score,
      eventsCount:    events.length,
      eventTypes:     [...new Set(events.map((e) => e.eventType))],
      homeFouls:      stats.homeFouls,
      awayFouls:      stats.awayFouls,
      homePenTotal:   stats.homePenalties.total,
      awayPenTotal:   stats.awayPenalties.total,
      // Raw row keys para detectar snake_case vs camelCase:
      rawMatchKeys:   Object.keys(match),
      rawEventSample: events[0] ?? null,
    });
    return c.json({ match, events, stats, lineups });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[match-detail] GET /:id error:', err);
    return c.json({ error: 'Database error' }, 500);
  }
});
