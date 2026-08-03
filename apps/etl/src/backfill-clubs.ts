/**
 * Backfill Fase 0.2 — modelo de clubes (Entity Resolution).
 *
 * Puebla `clubs` / `source_entity_map` / `club_names` a partir de `teams`
 * SIN fusionar nada: crea un club por cada team (1:1). Agrupar secciones bajo
 * un mismo club es el problema de ER (fases 2-3), no de este backfill. Ver
 * docs/SPEC_FASE0_MODELO_CLUBS.md §4.
 *
 * Es aditivo: sólo inserta filas nuevas y rellena `teams.club_id` (columna que
 * aún nadie lee). No borra `source_ref`/`alt_source_refs`: coexisten hasta
 * migrar el consumo. Idempotente y transaccional; re-ejecutar no duplica.
 *
 * Uso:
 *   npx tsx --env-file=apps/etl/.env apps/etl/src/backfill-clubs.ts
 *
 * Producción: correr una vez tras desplegar la migración 044, con prudencia
 * fuera de jornada (aunque es aditivo y no bloquea escrituras).
 */
import { fileURLToPath } from 'node:url';
import { withTransaction, closeDb } from '@sports/db';
import { createLogger } from '@sports/logger';

const log = createLogger({ service: 'backfill-clubs' });

/**
 * `valid_from` del nombre comercial inicial en `club_names`: arranque de la
 * temporada vigente (2025-26). No hay enlace directo team→season, así que se
 * parametriza. El histórico real de patrocinio se carga en fases posteriores.
 */
export const TEMPORADA_ACTUAL_INICIO = '2025-08-01';

export interface ResultadoBackfill {
  clubsCreados: number;
  teamsEnlazados: number;
  mapeosCreados: number;
  clubNamesCreados: number;
}

interface FilaTeam {
  id: string;
  sport_id: string;
  name: string;
  slug: string;
  city: string | null;
  country: string | null;
  logo_url: string | null;
}

/**
 * Rellena el modelo de clubes a partir de `teams` (1 club por team).
 * Idempotente y transaccional: re-ejecutar no duplica ni cruza entidades.
 */
export async function backfillClubs(
  opts: { temporadaInicio?: string } = {},
): Promise<ResultadoBackfill> {
  const temporadaInicio = opts.temporadaInicio ?? TEMPORADA_ACTUAL_INICIO;

  return withTransaction(async (client) => {
    // ── 4.1 Un club por team (1:1) ─────────────────────────────────────────
    // Variante TS robusta (spec §4.1): iterar e `INSERT ... RETURNING` en vez
    // de fiarlo a un JOIN por slug. Sólo procesa teams sin club_id → idempotente.
    const { rows: teams } = await client.query<FilaTeam>(
      `SELECT id, sport_id, name, slug, city, country, logo_url
         FROM teams
        WHERE club_id IS NULL
        ORDER BY created_at, id`,
    );

    let clubsCreados = 0;
    let teamsEnlazados = 0;

    for (const t of teams) {
      // clubs.UNIQUE(sport_id, slug) y teams.UNIQUE(sport_id, slug) ⇒ en 1:1 no
      // hay colisión entre clubs nuevos. El ON CONFLICT sólo salta al reintentar
      // un club ya creado: en ese caso se reutiliza (no se duplica).
      const ins = await client.query<{ id: string }>(
        `INSERT INTO clubs (sport_id, canonical_name, slug, city, country, crest_url)
              VALUES ($1, $2, $3, $4, COALESCE($5, 'ES'), $6)
         ON CONFLICT (sport_id, slug) DO NOTHING
           RETURNING id`,
        [t.sport_id, t.name, t.slug, t.city, t.country, t.logo_url],
      );

      let clubId: string;
      if (ins.rows.length > 0) {
        clubId = ins.rows[0]!.id;
        clubsCreados += 1;
      } else {
        const ex = await client.query<{ id: string }>(
          `SELECT id FROM clubs WHERE sport_id = $1 AND slug = $2`,
          [t.sport_id, t.slug],
        );
        clubId = ex.rows[0]!.id;
      }

      await client.query(
        `UPDATE teams SET club_id = $1 WHERE id = $2 AND club_id IS NULL`,
        [clubId, t.id],
      );
      teamsEnlazados += 1;
    }

    // ── 4.2 source_entity_map desde source_ref + alt_source_refs ────────────
    // Copia estructurada y determinista de los IDs de fuente. team_id set,
    // club_id NULL ⇒ respeta el CHECK (num_nonnulls = 1).
    const map1 = await client.query(
      `INSERT INTO source_entity_map (source_id, source_ref, team_id)
       SELECT t.source_id, t.source_ref, t.id
         FROM teams t
        WHERE t.source_id IS NOT NULL AND t.source_ref IS NOT NULL
       ON CONFLICT (source_id, source_ref) DO NOTHING`,
    );
    const map2 = await client.query(
      `INSERT INTO source_entity_map (source_id, source_ref, team_id)
       SELECT t.source_id, alt, t.id
         FROM teams t, unnest(t.alt_source_refs) AS alt
        WHERE t.source_id IS NOT NULL
       ON CONFLICT (source_id, source_ref) DO NOTHING`,
    );
    const mapeosCreados = (map1.rowCount ?? 0) + (map2.rowCount ?? 0);

    // ── 4.3 club_names inicial (nombre comercial vigente) ───────────────────
    const cn = await client.query(
      `INSERT INTO club_names (club_id, commercial_name, valid_from)
       SELECT c.id, c.canonical_name, $1::date
         FROM clubs c
       ON CONFLICT (club_id, commercial_name, valid_from) DO NOTHING`,
      [temporadaInicio],
    );
    const clubNamesCreados = cn.rowCount ?? 0;

    return { clubsCreados, teamsEnlazados, mapeosCreados, clubNamesCreados };
  });
}

/**
 * Revierte el backfill dejando `teams` igual que antes (club_id NULL) y
 * vaciando las tablas nuevas. `squad_level` no se toca (el backfill no lo
 * escribe: mantiene su DEFAULT 1). Reversibilidad exigida por el spec §6.7.
 */
export async function revertBackfillClubs(): Promise<void> {
  await withTransaction(async (client) => {
    // Anular primero el enlace: así ningún team referencia a clubs y se puede
    // borrar sin CASCADE. OJO: `TRUNCATE clubs CASCADE` arrastraría a `teams`
    // (teams.club_id → clubs) y se cargaría todos los equipos. Por eso DELETE
    // en orden de dependencias, nunca TRUNCATE CASCADE.
    await client.query(`UPDATE teams SET club_id = NULL`);
    await client.query(`DELETE FROM club_names`);
    await client.query(`DELETE FROM source_entity_map`);
    await client.query(`DELETE FROM clubs`);
  });
}

async function main(): Promise<void> {
  log.info('Iniciando backfill de clubes (Fase 0.2)');
  const r = await backfillClubs();
  log.info(r, 'Backfill completado');
}

// Sólo ejecutar como script directo; al importarlo (tests) no dispara main().
const esEjecucionDirecta = process.argv[1] === fileURLToPath(import.meta.url);
if (esEjecucionDirecta) {
  main()
    .catch((err) => {
      log.error({ err }, 'Error fatal en backfill');
      process.exit(1);
    })
    .finally(() => closeDb());
}
