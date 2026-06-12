/**
 * FUSIÓN CANÓNICA DE COMPETICIONES (P0 del rediseño de catálogo).
 *
 * La fuente modela cada EDICIÓN como competición distinta:
 *   "XXVIII CTO ESPAÑA SELECC MASCULINO"  → edición en romanos en el nombre
 *   "CAMPEONATO DE EUROPA FEMENINO 2011"  → año en el nombre
 *   "COPA DE SM LA REINA" / "COPA DE LA REINA" → variantes de protocolo
 *   "FASE ASCENSO" / "FASE DE ASCENSO"    → erratas
 *
 * Este script agrupa por clave normalizada (sin ediciones, años ni partículas)
 * y fusiona: las temporadas de las ediciones se mueven a la competición
 * canónica; las competiciones vacías resultantes se eliminan.
 *
 * SEGURO POR DEFECTO: sin --apply solo imprime el plan (dry-run).
 *
 * Uso (local o servidor):
 *   npx tsx --env-file=../../.env src/merge-canonical-competitions.ts           # plan
 *   npx tsx --env-file=../../.env src/merge-canonical-competitions.ts --apply   # ejecutar
 */
import { db, closeDb } from '@sports/db';

// ── Normalización ─────────────────────────────────────────────────────────────

const ROMAN = /^(?=[IVXLC])(X{0,3})(IX|IV|V?I{0,3})$/;

/** Tokens que no aportan identidad (protocolo, partículas, ordinales) */
const STOP = new Set([
  'DE', 'DEL', 'LA', 'EL', 'LOS', 'LAS', 'SM', 'S.M.', 'S.M', 'SAR', 'SS.MM',
]);

/** Sinónimos → forma canónica del token */
const SYNONYM: Record<string, string> = {
  'SELECCIONES': 'SELECC',
  'SELECCION': 'SELECC',
  'FEM': 'FEMENINO',
  'FEMENINA': 'FEMENINO',
  'MASC': 'MASCULINO',
  'MASCULINA': 'MASCULINO',
  'CAMPEONATO': 'CTO',
  'CPTO': 'CTO',
};

export function canonicalKey(name: string): string {
  const tokens = name
    .toUpperCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9/ ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    // Fuera: romanos (ediciones), años (1999, 2011/2012, 2012-13), ordinales (1ª, 2O)
    .filter((t) => !ROMAN.test(t))
    .filter((t) => !/^(19|20)\d{2}([/-](19|20)?\d{2})?$/.test(t))
    .filter((t) => !/^\d+[OA]?$/.test(t))
    .filter((t) => !STOP.has(t))
    .map((t) => SYNONYM[t] ?? t);
  return tokens.join(' ');
}

// ── Main ──────────────────────────────────────────────────────────────────────

interface CompRow {
  id: string;
  name: string;
  slug: string;
  season_count: number;
  match_count: number;
}

async function main() {
  const apply = process.argv.includes('--apply');

  const res = await db.query<CompRow>(`
    SELECT c.id, c.name, c.slug,
           count(DISTINCT s.id)::int AS season_count,
           count(m.id)::int AS match_count
    FROM competitions c
    LEFT JOIN seasons s ON s.competition_id = c.id
    LEFT JOIN matches m ON m.season_id = s.id
    GROUP BY c.id
  `);

  // Agrupar por clave canónica
  const groups = new Map<string, CompRow[]>();
  for (const row of res.rows) {
    const key = canonicalKey(row.name);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }

  const mergeGroups = Array.from(groups.entries()).filter(([, rows]) => rows.length > 1);

  console.log(`\nCompeticiones: ${res.rows.length} · Grupos fusionables: ${mergeGroups.length}\n`);

  let merged = 0, removed = 0;

  for (const [key, rows] of mergeGroups) {
    // Canónica: la que más partidos tiene (su nombre suele ser el "limpio");
    // desempate: nombre más corto (sin ordinales suele ser más corto).
    const sorted = [...rows].sort((a, b) =>
      b.match_count - a.match_count || a.name.length - b.name.length
    );
    const canonical = sorted[0]!;
    const dupes = sorted.slice(1);

    console.log(`■ ${key}`);
    console.log(`  → CANÓNICA: "${canonical.name}" (${canonical.season_count} temp, ${canonical.match_count} partidos)`);
    for (const d of dupes) {
      console.log(`     fusionar: "${d.name}" (${d.season_count} temp, ${d.match_count} partidos)`);
    }

    if (!apply) continue;

    for (const dupe of dupes) {
      // Mover temporadas a la canónica, evitando colisión de slug
      const seasons = await db.query<{ id: string; slug: string }>(
        `SELECT id, slug FROM seasons WHERE competition_id = $1`, [dupe.id]
      );
      for (const season of seasons.rows) {
        const clash = await db.query(
          `SELECT 1 FROM seasons WHERE competition_id = $1 AND slug = $2`,
          [canonical.id, season.slug]
        );
        const newSlug = (clash.rowCount ?? 0) > 0 ? `${season.slug}-${dupe.slug.slice(0, 12)}` : season.slug;
        await db.query(
          `UPDATE seasons SET competition_id = $1, slug = $2, updated_at = NOW() WHERE id = $3`,
          [canonical.id, newSlug, season.id]
        );
      }
      await db.query(`DELETE FROM competitions WHERE id = $1`, [dupe.id]);
      removed++;
    }
    merged++;
  }

  if (apply) {
    console.log(`\n✅ ${merged} grupos fusionados · ${removed} competiciones duplicadas eliminadas.`);
  } else {
    console.log(`\n(dry-run) Revisa el plan. Para ejecutar: añade --apply`);
  }
}

main()
  .catch((err) => { console.error('❌', err); process.exit(1); })
  .finally(() => closeDb());
