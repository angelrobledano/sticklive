/**
 * Backfill Fase 1 — caché de alias del escalón 2 del embudo ER.
 *
 * Da contenido a `team_aliases` de forma DETERMINISTA: para cada team, el
 * nombre (y short_name) normalizado con `normalizeTeamName()` → alias
 * `created_by='deterministic'`, `source_id` = el del team. Así el resolver
 * empieza a resolver por alias exacto desde el día uno, sin esperar al fuzzy.
 *
 * Idempotente (no duplica, incluso con source_id NULL) y reversible. No inventa
 * nada: sólo copia nombres ya existentes a su forma normalizada.
 *
 * Uso:
 *   npx tsx --env-file=.env apps/etl/src/backfill-team-aliases.ts
 */
import { fileURLToPath } from 'node:url';
import { withTransaction, closeDb } from '@sports/db';
import { createLogger } from '@sports/logger';
import { normalizeTeamName } from './transformers/normalize.js';

const log = createLogger({ service: 'backfill-team-aliases' });

export interface ResultadoAliases {
  aliasCreados: number;
  teamsProcesados: number;
}

interface FilaTeam {
  id: string;
  name: string;
  short_name: string | null;
  source_id: string | null;
}

export async function backfillTeamAliases(): Promise<ResultadoAliases> {
  return withTransaction(async (client) => {
    // Tokens de sponsor para depurar el nombre (la tabla puede estar vacía aún).
    const { rows: sponsorRows } = await client.query<{ name: string; aliases: string[] }>(
      `SELECT name, aliases FROM sponsors`,
    );
    const sponsorTokens: string[] = [];
    for (const s of sponsorRows) {
      sponsorTokens.push(s.name);
      for (const a of s.aliases ?? []) sponsorTokens.push(a);
    }

    const { rows: teams } = await client.query<FilaTeam>(
      `SELECT id, name, short_name, source_id FROM teams ORDER BY created_at, id`,
    );

    let aliasCreados = 0;
    for (const t of teams) {
      const variantes = new Set([t.name, t.short_name].filter((x): x is string => !!x));
      for (const raw of variantes) {
        const normalized = normalizeTeamName(raw, sponsorTokens);
        if (!normalized) continue;
        // Idempotente incluso con source_id NULL: IS NOT DISTINCT FROM iguala NULLs.
        const res = await client.query(
          `INSERT INTO team_aliases (team_id, raw_text, normalized, source_id, confidence, status, created_by)
           SELECT $1, $2, $3, $4, 1.0, 'confirmed', 'deterministic'
           WHERE NOT EXISTS (
             SELECT 1 FROM team_aliases
              WHERE normalized = $3 AND source_id IS NOT DISTINCT FROM $4::uuid
           )`,
          [t.id, raw, normalized, t.source_id],
        );
        aliasCreados += res.rowCount ?? 0;
      }
    }

    return { aliasCreados, teamsProcesados: teams.length };
  });
}

/** Deshace SÓLO los aliases deterministas de este backfill. */
export async function revertBackfillTeamAliases(): Promise<void> {
  await withTransaction(async (client) => {
    await client.query(`DELETE FROM team_aliases WHERE created_by = 'deterministic'`);
  });
}

async function main(): Promise<void> {
  log.info('Iniciando backfill de team_aliases (Fase 1)');
  const r = await backfillTeamAliases();
  log.info(r, 'Backfill de aliases completado');
}

const esEjecucionDirecta = process.argv[1] === fileURLToPath(import.meta.url);
if (esEjecucionDirecta) {
  main()
    .catch((err) => {
      log.error({ err }, 'Error fatal en backfill de aliases');
      process.exit(1);
    })
    .finally(() => closeDb());
}
