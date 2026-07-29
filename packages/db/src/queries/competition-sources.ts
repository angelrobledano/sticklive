/**
 * Lectura de `competition_sources` — la configuración de scraping por
 * competición (punto 10, migración 040).
 *
 * Fase 1: este helper existe pero todavía NADIE lo consume. Lo usará la Fase 2
 * para que `run-pipeline` sepa qué idc scrapear sin constantes hardcodeadas.
 */
import { db } from '../client.js';

/** Identificadores en la fuente. `idc` es el primario; los demás, secundarios. */
export interface ExternalIds {
  /** idc primario de la competición en sidgad (calendario/standings/actas). */
  idc: string;
  /** idc que aportan partidos como fase de playoff de esta competición. */
  playoff_idcs?: string[];
  /** idc de copas/eliminatorias asociadas. */
  cup_idcs?: string[];
}

/** Política de sondeo en directo. NULL en BD = usar los defaults de cron-live. */
export interface PollPolicy {
  liveIntervalS?: number;
  windowHours?: number;
}

export interface CompetitionSource {
  id: string;
  competitionId: string;
  competitionName: string;
  competitionSourceRef: string | null;
  sourceId: string;
  scraperKey: string;
  externalIds: ExternalIds;
  pollPolicy: PollPolicy | null;
  isActive: boolean;
}

interface Row {
  id: string;
  competition_id: string;
  competition_name: string;
  competition_source_ref: string | null;
  source_id: string;
  scraper_key: string;
  external_ids: ExternalIds;
  poll_policy: PollPolicy | null;
  is_active: boolean;
}

function mapRow(r: Row): CompetitionSource {
  return {
    id: r.id,
    competitionId: r.competition_id,
    competitionName: r.competition_name,
    competitionSourceRef: r.competition_source_ref,
    sourceId: r.source_id,
    scraperKey: r.scraper_key,
    externalIds: r.external_ids,
    pollPolicy: r.poll_policy,
    isActive: r.is_active,
  };
}

const SELECT = `
  SELECT cs.id, cs.competition_id, c.name AS competition_name,
         c.source_ref AS competition_source_ref,
         cs.source_id, ds.scraper_key,
         cs.external_ids, cs.poll_policy, cs.is_active
    FROM competition_sources cs
    JOIN competitions c  ON c.id = cs.competition_id
    JOIN data_sources ds ON ds.id = cs.source_id
`;

/** Todas las configuraciones activas. Vacío si no hay ninguna sembrada. */
export async function getActiveCompetitionSources(): Promise<CompetitionSource[]> {
  const res = await db.query<Row>(`${SELECT} WHERE cs.is_active = TRUE ORDER BY c.name`);
  return res.rows.map(mapRow);
}

/** Configuraciones activas de un scraper concreto (p. ej. 'fep_hockey'). */
export async function getActiveCompetitionSourcesByScraper(
  scraperKey: string,
): Promise<CompetitionSource[]> {
  const res = await db.query<Row>(
    `${SELECT} WHERE cs.is_active = TRUE AND ds.scraper_key = $1 ORDER BY c.name`,
    [scraperKey],
  );
  return res.rows.map(mapRow);
}

/**
 * Una competición lista para scrapear: su temporada vigente y sus idc. Es lo
 * que consume el modo multi de run-pipeline (punto 10, Fase 2). `seasonId` es
 * NULL cuando la competición está activa pero no tiene temporada is_current:
 * el runner la registra y la omite en vez de fallar.
 */
export interface ScrapePlanItem {
  competitionId: string;
  competitionName: string;
  seasonId: string | null;
  primaryIdc: string;
  playoffIdcs: string[];
  /** Zona IANA en la que la fuente publica los horarios (default Europe/Madrid). */
  timezone: string;
}

/**
 * Plan de scrape de un scraper: competiciones activas con su temporada vigente
 * (LEFT JOIN a seasons is_current) y sus idc, en UNA query. Las que no tienen
 * temporada actual salen con seasonId NULL para poder diagnosticarlas.
 */
export async function getActiveScrapePlan(scraperKey: string): Promise<ScrapePlanItem[]> {
  const res = await db.query<{
    competition_id: string;
    competition_name: string;
    season_id: string | null;
    external_ids: ExternalIds;
    timezone: string;
  }>(
    `SELECT cs.competition_id, c.name AS competition_name,
            s.id AS season_id, cs.external_ids, c.timezone
       FROM competition_sources cs
       JOIN competitions c  ON c.id = cs.competition_id
       JOIN data_sources ds ON ds.id = cs.source_id
       LEFT JOIN seasons s  ON s.competition_id = cs.competition_id AND s.is_current = TRUE
      WHERE cs.is_active = TRUE AND ds.scraper_key = $1
      ORDER BY c.name`,
    [scraperKey],
  );
  return res.rows.map((r) => ({
    competitionId: r.competition_id,
    competitionName: r.competition_name,
    seasonId: r.season_id,
    primaryIdc: r.external_ids.idc,
    playoffIdcs: r.external_ids.playoff_idcs ?? [],
    timezone: r.timezone,
  }));
}

/** Upsert de una configuración (para el seed y, en la Fase 3, el alta por admin). */
export async function upsertCompetitionSource(input: {
  competitionId: string;
  sourceId: string;
  externalIds: ExternalIds;
  pollPolicy?: PollPolicy | null;
  isActive?: boolean;
}): Promise<string> {
  const res = await db.query<{ id: string }>(
    `INSERT INTO competition_sources (competition_id, source_id, external_ids, poll_policy, is_active)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (competition_id) DO UPDATE SET
       source_id    = EXCLUDED.source_id,
       external_ids = EXCLUDED.external_ids,
       poll_policy  = EXCLUDED.poll_policy,
       is_active    = EXCLUDED.is_active,
       updated_at   = NOW()
     RETURNING id`,
    [
      input.competitionId,
      input.sourceId,
      JSON.stringify(input.externalIds),
      input.pollPolicy ? JSON.stringify(input.pollPolicy) : null,
      input.isActive ?? true,
    ],
  );
  return res.rows[0]!.id;
}
