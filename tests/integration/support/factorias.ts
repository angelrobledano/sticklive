/**
 * Factorías para montar el mínimo de datos que un test necesita.
 *
 * `matches` cuelga de una cadena de claves ajenas —deporte → competición →
 * temporada, más dos equipos— así que insertar un partido a mano son seis
 * INSERT y un test ilegible donde el 80% es andamiaje. Esto lo reduce a una
 * línea y deja el test hablando de lo que prueba.
 *
 * Todo devuelve el UUID generado por la base, no ids inventados: así los tests
 * ejercitan las claves ajenas de verdad.
 */
import { db } from '@sports/db';

let contador = 0;
/** Sufijo único por proceso para no chocar con los UNIQUE de slug/name. */
function unico(prefijo: string): string {
  contador += 1;
  return `${prefijo}-${contador}`;
}

export async function crearDeporte(slug = 'hockey-patines'): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO sports (name, slug) VALUES ($1, $2)
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [`Deporte ${slug}`, slug]
  );
  return rows[0]!.id;
}

export async function crearFuente(scraperKey = 'fep_hockey'): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO data_sources (name, base_url, scraper_key) VALUES ($1, $2, $3)
     ON CONFLICT (scraper_key) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [`Fuente ${scraperKey}`, `https://ejemplo.invalido/${scraperKey}`, scraperKey]
  );
  return rows[0]!.id;
}

export async function crearCompeticion(sportId: string, sourceRef?: string): Promise<string> {
  const slug = unico('competicion');
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO competitions (sport_id, name, slug, source_ref) VALUES ($1, $2, $3, $4) RETURNING id`,
    [sportId, slug, slug, sourceRef ?? `fep_competition_${slug}`]
  );
  return rows[0]!.id;
}

export async function crearTemporada(
  competitionId: string,
  opts: { esActual?: boolean } = {}
): Promise<string> {
  const slug = unico('temporada');
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO seasons (competition_id, name, slug, is_current) VALUES ($1, $2, $3, $4) RETURNING id`,
    [competitionId, slug, slug, opts.esActual ?? true]
  );
  return rows[0]!.id;
}

export async function crearEquipo(sportId: string, nombre?: string): Promise<string> {
  const slug = unico('equipo');
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO teams (sport_id, name, slug) VALUES ($1, $2, $3) RETURNING id`,
    [sportId, nombre ?? slug, slug]
  );
  return rows[0]!.id;
}

export interface EscenarioPartido {
  sportId: string;
  competitionId: string;
  seasonId: string;
  homeTeamId: string;
  awayTeamId: string;
  matchId: string;
}

/**
 * Un partido listo para usar, con toda su cadena de dependencias.
 *
 * `scheduledAt` acepta un desplazamiento en horas respecto a AHORA, que es como
 * lo piensan los tests que van de ventanas de tiempo ("un partido que empezó
 * hace 6 horas"). Fechas absolutas harían que el test caducase.
 */
export async function crearPartido(opts: {
  status?: 'scheduled' | 'live' | 'finished' | 'postponed' | 'cancelled';
  horasDesdeInicio?: number;
  seasonId?: string;
  sourceRef?: string;
} = {}): Promise<EscenarioPartido> {
  const sportId = await crearDeporte();
  const competitionId = await crearCompeticion(sportId);
  const seasonId = opts.seasonId ?? (await crearTemporada(competitionId));
  const homeTeamId = await crearEquipo(sportId);
  const awayTeamId = await crearEquipo(sportId);

  const horas = opts.horasDesdeInicio ?? 0;
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO matches (season_id, home_team_id, away_team_id, status, scheduled_at, source_ref)
     VALUES ($1, $2, $3, $4, NOW() - make_interval(hours => $5::int), $6)
     RETURNING id`,
    [seasonId, homeTeamId, awayTeamId, opts.status ?? 'scheduled', horas, opts.sourceRef ?? unico('fep_match')]
  );

  return { sportId, competitionId, seasonId, homeTeamId, awayTeamId, matchId: rows[0]!.id };
}

/** Lee los eventos de un partido, ordenados de forma estable para comparar. */
export async function eventosDe(matchId: string): Promise<Array<{
  id: string; sourceRef: string | null; eventType: string; minute: number | null; period: number | null;
}>> {
  const { rows } = await db.query<{
    id: string; source_ref: string | null; event_type: string; minute: number | null; period: number | null;
  }>(
    `SELECT id, source_ref, event_type, minute, period
       FROM match_events WHERE match_id = $1
      ORDER BY period NULLS FIRST, minute NULLS FIRST, source_ref NULLS FIRST`,
    [matchId]
  );
  return rows.map((r) => ({
    id: r.id, sourceRef: r.source_ref, eventType: r.event_type, minute: r.minute, period: r.period,
  }));
}
