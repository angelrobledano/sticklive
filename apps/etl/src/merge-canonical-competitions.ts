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

/** ¿El token es de edición (romano, año, ordinal suelto)? */
function isEditionToken(t: string): boolean {
  return ROMAN.test(t)
    || /^(19|20)\d{2}([/-](19|20)?\d{2})?$/.test(t)
    || /^\d+[OA]?$/.test(t);
}

export function canonicalKey(name: string): string {
  const tokens = name
    .toUpperCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    // SUB-17 / SUB 16: el número ES identidad (categoría), no edición → soldar
    .replace(/SUB[- ]?(\d+)/g, 'SUB$1')
    .replace(/[^A-Z0-9/ ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter((t) => !isEditionToken(t))
    .filter((t) => !STOP.has(t))
    .map((t) => SYNONYM[t] ?? t);
  return tokens.join(' ');
}

/** ¿El nombre está "limpio" (sin tokens de edición)? */
function isCleanName(name: string): boolean {
  return name
    .toUpperCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/SUB[- ]?(\d+)/g, 'SUB$1')
    .replace(/[^A-Z0-9/ ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .every((t) => !isEditionToken(t));
}

/** Nombre de display limpio: el original sin los tokens de edición */
function cleanedDisplayName(name: string): string {
  return name
    .split(/\s+/)
    .filter((raw) => {
      const t = raw.toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Z0-9/]/g, '');
      return t.length === 0 || !isEditionToken(t);
    })
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Competiciones que NUNCA deben entrar en una fusión: el normalizador
 * podría confundirlas con su hermana mayor, pero son entidades distintas.
 */
const NEVER_MERGE = (name: string): boolean =>
  /9\s*[º°]?\s*[–-]\s*10|9 Y 10|PLAY\s*-?\s*OUT/i.test(name);

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

  // Agrupar por clave canónica (excluyendo las protegidas)
  const groups = new Map<string, CompRow[]>();
  for (const row of res.rows) {
    if (NEVER_MERGE(row.name)) continue; // 9º-10º, playout... entidades propias
    const key = canonicalKey(row.name);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }

  const mergeGroups = Array.from(groups.entries()).filter(([, rows]) => rows.length > 1);

  console.log(`\nCompeticiones: ${res.rows.length} · Grupos fusionables: ${mergeGroups.length}\n`);

  let merged = 0, removed = 0;

  for (const [key, rows] of mergeGroups) {
    // Canónica: preferir nombre LIMPIO (sin edición); después, más partidos.
    const sorted = [...rows].sort((a, b) =>
      Number(isCleanName(b.name)) - Number(isCleanName(a.name))
      || b.match_count - a.match_count
      || a.name.length - b.name.length
    );
    const canonical = sorted[0]!;
    const dupes = sorted.slice(1);

    // Si ni la canónica tiene nombre limpio, se le limpia el display
    const displayName = isCleanName(canonical.name)
      ? canonical.name
      : cleanedDisplayName(canonical.name);

    console.log(`■ ${key}`);
    console.log(`  → CANÓNICA: "${canonical.name}"${displayName !== canonical.name ? ` → renombrar a "${displayName}"` : ''} (${canonical.season_count} temp, ${canonical.match_count} partidos)`);
    for (const d of dupes) {
      console.log(`     fusionar: "${d.name}" (${d.season_count} temp, ${d.match_count} partidos)`);
    }

    if (!apply) continue;

    if (displayName !== canonical.name) {
      await db.query(
        `UPDATE competitions SET name = $2, updated_at = NOW() WHERE id = $1`,
        [canonical.id, displayName]
      );
    }

    for (const dupe of dupes) {
      // Mover temporadas a la canónica, evitando colisión de slug
      const seasons = await db.query<{ id: string; slug: string }>(
        `SELECT id, slug FROM seasons WHERE competition_id = $1`, [dupe.id]
      );
      for (const season of seasons.rows) {
        // Slug único dentro de la canónica: probar base, base-2, base-3...
        let newSlug = season.slug;
        for (let n = 2; ; n++) {
          const clash = await db.query(
            `SELECT 1 FROM seasons WHERE competition_id = $1 AND slug = $2`,
            [canonical.id, newSlug]
          );
          if ((clash.rowCount ?? 0) === 0) break;
          newSlug = `${season.slug}-${n}`;
        }
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
