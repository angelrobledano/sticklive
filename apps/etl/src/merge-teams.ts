/**
 * Fusiona dos fichas del mismo equipo (ver packages/db/src/queries/merge-teams.ts).
 *
 *   # Parejas candidatas: equipos de una fuente con el mismo nombre normalizado
 *   # y la misma sección que un equipo de OTRA fuente (no fusiona nada)
 *   node dist/apps/etl/src/merge-teams.js --suggest=fvp
 *
 *   # Una fusión: en seco por defecto, --write para aplicar
 *   node dist/apps/etl/src/merge-teams.js --keep=<uuid> --merge=<uuid>
 *   node dist/apps/etl/src/merge-teams.js --keep=<uuid> --merge=<uuid> --write
 *
 * --force salta la guarda de sección (género/categoría). Úsalo solo si de
 * verdad son el mismo equipo mal clasificado en una de las fuentes.
 */
import { db, closeDb, mergeTeams } from '@sports/db';

const argv = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, ...v] = a.replace(/^--/, '').split('=');
  return [k, v.length ? v.join('=') : 'true'];
})) as Record<string, string>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function suggest(prefix: string) {
  if (!/^[a-z]+$/.test(prefix)) throw new Error(`--suggest inválido: ${prefix}`);
  const norm = (col: string) =>
    `regexp_replace(translate(lower(${col}), 'áéíóúàèìòùäëïöüñç', 'aeiouaeiouaeiounc'), '[^a-z0-9]', '', 'g')`;
  const { rows } = await db.query<{
    keep_id: string; keep_name: string; keep_comps: string | null; merge_id: string; merge_name: string;
    merge_comps: string | null; section: string;
  }>(
    `WITH comps AS (
       SELECT st.team_id, string_agg(DISTINCT c.short_name, ', ') AS names
         FROM season_teams st JOIN seasons s ON s.id = st.season_id AND s.is_current
         JOIN competitions c ON c.id = s.competition_id GROUP BY st.team_id)
     SELECT o.id AS keep_id, o.name AS keep_name, co.names AS keep_comps,
            n.id AS merge_id, n.name AS merge_name, cn.names AS merge_comps,
            COALESCE(n.gender, '?') || '/' || COALESCE(n.age_category, '?') AS section
       FROM teams n
       JOIN teams o ON o.id <> n.id AND ${norm('o.name')} = ${norm('n.name')}
                   AND o.gender IS NOT DISTINCT FROM n.gender
                   AND o.age_category IS NOT DISTINCT FROM n.age_category
                   AND COALESCE(o.source_ref, '') NOT LIKE $1
       LEFT JOIN comps co ON co.team_id = o.id
       LEFT JOIN comps cn ON cn.team_id = n.id
      WHERE n.source_ref LIKE $1
      ORDER BY n.name`,
    [`${prefix}\\_%`],
  );
  if (rows.length === 0) { console.log(`Sin parejas candidatas para "${prefix}".`); return; }
  console.log(`${rows.length} parejas candidatas (se queda la de la otra fuente, se fusiona la de "${prefix}"):\n`);
  for (const r of rows) {
    console.log(`${r.merge_name}  [${r.section}]`);
    console.log(`   queda:    ${r.keep_name}  · ${r.keep_comps ?? 'sin temporada actual'}`);
    console.log(`   fusiona:  ${r.merge_name}  · ${r.merge_comps ?? 'sin temporada actual'}`);
    console.log(`   → node dist/apps/etl/src/merge-teams.js --keep=${r.keep_id} --merge=${r.merge_id}\n`);
  }
  console.log('Revisa cada pareja: mismo nombre no siempre es el mismo equipo (un filial puede llamarse igual).');
}

async function main() {
  if (argv['suggest']) return suggest(argv['suggest']);
  const keep = argv['keep'] ?? '';
  const merge = argv['merge'] ?? '';
  if (!UUID.test(keep) || !UUID.test(merge)) throw new Error('Uso: --keep=<uuid> --merge=<uuid> [--write] [--force]');
  const write = argv['write'] === 'true';
  const r = await mergeTeams(keep, merge, { force: argv['force'] === 'true', dryRun: !write });
  console.log(`${write ? 'FUSIONADO' : '(en seco)'}  "${r.merge.name}"  →  "${r.keep.name}"`);
  const fmt = (o: Record<string, number>) => Object.entries(o).filter(([, n]) => n > 0).map(([k, n]) => `${k}=${n}`).join(' ') || '—';
  console.log(`  movido:     ${fmt(r.moved)}`);
  console.log(`  descartado: ${fmt(r.dropped)}  (filas duplicadas en una temporada común)`);
  if (!write) console.log('Nada escrito. Repite con --write.');
}

main().catch((err) => { console.error(`ERROR: ${err instanceof Error ? err.message : String(err)}`); process.exitCode = 1; })
  .finally(() => closeDb());
