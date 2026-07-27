/**
 * Seed de `competition_sources` desde la configuración ACTUAL (punto 10, Fase 1).
 *
 * Captura en datos lo que hoy está hardcodeado en run-pipeline.ts. Se ejecuta
 * una vez, contra la BD que ya tiene las competiciones creadas:
 *
 *   npx tsx apps/etl/src/seed-competition-sources.ts          # dry-run (muestra)
 *   npx tsx apps/etl/src/seed-competition-sources.ts --write  # escribe
 *
 * ── Qué hace ────────────────────────────────────────────────────────────────
 *
 * Para CADA competición con source_ref, crea una fila:
 *   · idc primario  → derivado del source_ref (data-driven, sirva la que sirva).
 *   · scraper       → inferido del prefijo (wse_* → worldskate, resto → fep).
 *   · secundarios   → del mapa SECONDARIES de abajo (conocimiento de dominio).
 *
 * Los idc secundarios (playoff/copa) NO tienen competición propia: alimentan a
 * su liga (migraciones 014/026). El mapa está keyed por el idc PRIMARIO.
 *
 * Nada lee esta tabla todavía (Fase 1). El seed imprime cada fila para revisar
 * antes de la Fase 2, que sí la consumirá; los secundarios de copas/femenino se
 * afinan entonces, con la BD de producción delante.
 */
import { db, closeDb, upsertCompetitionSource, type ExternalIds } from '@sports/db';
import { createLogger } from '@sports/logger';

const log = createLogger({ service: 'seed-competition-sources' });

/**
 * Asociaciones idc-primario → secundarios. Confirmadas contra la BD de
 * producción (27/07/2026): sólo las dos ligas de oro tienen un playoff que se
 * fusiona en la propia liga como round_type (migraciones 014/026), por lo que
 * su idc no tiene competición propia y vive aquí como secundario:
 *   · 3150 = OK Liga Masculina → playoff idc 3481.
 *   · 3151 = OK Liga Femenina (Iberdrola) → playoff idc 3484.
 *
 * Las copas (Rey 3258, Reina 3259, Supercopas 3177/3178, SAR 3301/3302) SÍ son
 * competiciones propias en la BD: el seed les crea fila en el bucle principal,
 * NO son secundarios. El `Set` CUP_IDCS de run-pipeline.ts sólo enruta partidos
 * a su temporada; sus 3260/3261 son idc fantasma (no existen en prod).
 */
const SECONDARIES: Record<string, { playoff_idcs?: string[]; cup_idcs?: string[] }> = {
  '3150': { playoff_idcs: ['3481'] },
  '3151': { playoff_idcs: ['3484'] },
};

/** `fep_competition_3150` | `3150` | `wse_competition_320` → `3150` | `320`. */
function idcFromSourceRef(ref: string): string {
  return ref.replace(/^(fep|wse)_competition_/, '');
}

function scraperKeyForRef(ref: string): string {
  return ref.startsWith('wse_') ? 'worldskate_hockey' : 'fep_hockey';
}

async function main() {
  const write = process.argv.includes('--write');

  const comps = await db.query<{ id: string; name: string; source_ref: string | null }>(
    `SELECT id, name, source_ref FROM competitions
      WHERE source_ref IS NOT NULL AND archived_at IS NULL
      ORDER BY name`,
  );

  if (comps.rows.length === 0) {
    log.warn('No hay competiciones con source_ref — ¿seed de competiciones ejecutado?');
    return;
  }

  // data_sources por scraper_key (para el source_id).
  const dsRes = await db.query<{ id: string; scraper_key: string }>(
    `SELECT id, scraper_key FROM data_sources`,
  );
  const sourceIdByKey = new Map(dsRes.rows.map((r) => [r.scraper_key, r.id]));

  let written = 0;
  for (const c of comps.rows) {
    const ref = c.source_ref!;
    const scraperKey = scraperKeyForRef(ref);
    const sourceId = sourceIdByKey.get(scraperKey);
    if (!sourceId) {
      log.warn({ competition: c.name, scraperKey }, 'Sin data_source para ese scraper — se omite');
      continue;
    }
    const idc = idcFromSourceRef(ref);
    const externalIds: ExternalIds = { idc, ...(SECONDARIES[idc] ?? {}) };

    log.info({ competition: c.name, scraperKey, externalIds }, write ? '→ escribiendo' : '→ (dry-run)');

    if (write) {
      await upsertCompetitionSource({ competitionId: c.id, sourceId, externalIds });
      written++;
    }
  }

  log.info({ total: comps.rows.length, written, modo: write ? 'write' : 'dry-run' },
    write ? '✅ seed aplicado' : 'ℹ dry-run (usa --write para escribir)');
}

main()
  .catch((err) => { log.error({ err }, 'seed-competition-sources falló'); process.exitCode = 1; })
  .finally(() => closeDb());
