import { Hono } from 'hono';
import { db } from '@sports/db';

export const playerDetailRouter = new Hono();

interface PlayerRow {
  id: string;
  first_name: string;
  last_name: string;
  birth_date: Date | null;
  nationality: string | null;
  position: string | null;
  source_ref: string | null;
  photo_url: string | null;
}

interface TeamRow {
  team_id: string;
  team_name: string;
  team_short_name: string | null;
  team_logo_url: string | null;
  jersey_number: number | null;
  season_id: string;
}

interface CompStatsRow {
  competition_id: string;
  competition_name: string;
  competition_short: string | null;
  pj: string;           // COUNT DISTINCT — devuelve bigint como string en pg
  goals: string;
  blue_cards: string;
  red_cards: string;
  penalties_total: string;
  penalties_scored: string;
}

/**
 * GET /players/:id
 * Devuelve ficha del jugador, equipo actual y estadísticas de la temporada
 * activa desglosadas por competición.
 */
playerDetailRouter.get('/:id', async (c) => {
  const id = c.req.param('id');

  try {
    // 1) Datos del jugador
    const playerRes = await db.query<PlayerRow>(
      `SELECT id, first_name, last_name, birth_date, nationality, position, source_ref, photo_url
       FROM players WHERE id = $1`,
      [id]
    );
    if (playerRes.rows.length === 0) return c.json({ error: 'Player not found' }, 404);
    const p = playerRes.rows[0]!;

    // 2) Equipo actual (temporada activa, registro más reciente)
    const teamRes = await db.query<TeamRow>(`
      SELECT
        t.id          AS team_id,
        t.name        AS team_name,
        t.short_name  AS team_short_name,
        t.logo_url    AS team_logo_url,
        tp.jersey_number,
        tp.season_id
      FROM team_players tp
      JOIN teams t   ON t.id  = tp.team_id
      JOIN seasons s ON s.id  = tp.season_id
      WHERE tp.player_id = $1
        AND s.is_current  = TRUE
        AND tp.is_active  = TRUE
      ORDER BY s.start_date DESC NULLS LAST
      LIMIT 1
    `, [id]);

    const teamRow = teamRes.rows[0] ?? null;

    // 3) Stats por competición (temporada activa)
    //    PJ = partidos en los que el jugador tiene al menos 1 evento (proxy)
    //    Penaltis marcados: detail ILIKE cualquier variante positiva
    const statsRes = await db.query<CompStatsRow>(`
      SELECT
        c.id                AS competition_id,
        c.name              AS competition_name,
        c.short_name        AS competition_short,
        COUNT(DISTINCT me.match_id)                                          AS pj,
        COUNT(*) FILTER (WHERE me.event_type = 'goal')                       AS goals,
        COUNT(*) FILTER (WHERE me.event_type = 'blue_card')                  AS blue_cards,
        COUNT(*) FILTER (WHERE me.event_type = 'red_card')                   AS red_cards,
        COUNT(*) FILTER (WHERE me.event_type = 'penalty')                    AS penalties_total,
        COUNT(*) FILTER (
          WHERE me.event_type = 'penalty'
            AND (
              me.detail ILIKE '%gol%'
              OR me.detail ILIKE '%marcado%'
              OR me.detail ILIKE '%anotado%'
              OR me.detail ILIKE '%dentro%'
            )
        )                                                                     AS penalties_scored
      FROM match_events me
      JOIN matches m    ON m.id  = me.match_id
      JOIN seasons s    ON s.id  = m.season_id
      JOIN competitions c ON c.id = s.competition_id
      WHERE me.player_id = $1
        AND s.is_current = TRUE
      GROUP BY c.id, c.name, c.short_name
      ORDER BY goals DESC, pj DESC
    `, [id]);

    // 4) Totales globales de la temporada (suma de todas las competiciones)
    const totals = statsRes.rows.reduce(
      (acc, r) => ({
        pj:              acc.pj              + Number(r.pj),
        goals:           acc.goals           + Number(r.goals),
        blueCards:       acc.blueCards       + Number(r.blue_cards),
        redCards:        acc.redCards        + Number(r.red_cards),
        penaltiesTotal:  acc.penaltiesTotal  + Number(r.penalties_total),
        penaltiesScored: acc.penaltiesScored + Number(r.penalties_scored),
      }),
      { pj: 0, goals: 0, blueCards: 0, redCards: 0, penaltiesTotal: 0, penaltiesScored: 0 }
    );

    return c.json({
      player: {
        id:          p.id,
        firstName:   p.first_name,
        lastName:    p.last_name,
        birthDate:   p.birth_date,
        nationality: p.nationality,
        position:    p.position,
        sourceRef:   p.source_ref,
        photoUrl:    p.photo_url,
      },
      currentTeam: teamRow ? {
        id:           teamRow.team_id,
        name:         teamRow.team_name,
        shortName:    teamRow.team_short_name,
        logoUrl:      teamRow.team_logo_url,
        jerseyNumber: teamRow.jersey_number,
        seasonId:     teamRow.season_id,
      } : null,
      seasonTotals: totals,
      statsByCompetition: statsRes.rows.map((r) => ({
        competitionId:    r.competition_id,
        competitionName:  r.competition_name,
        competitionShort: r.competition_short,
        pj:               Number(r.pj),
        goals:            Number(r.goals),
        blueCards:        Number(r.blue_cards),
        redCards:         Number(r.red_cards),
        penaltiesTotal:   Number(r.penalties_total),
        penaltiesScored:  Number(r.penalties_scored),
      })),
    });
  } catch (err) {
    return c.json({ error: 'Database error' }, 500);
  }
});
