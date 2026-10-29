/**
 * Aplica un plan de revisión de clubes (Plan B1) generado a partir de la
 * revisión de las fichas publicadas. CSV con `;` y cabecera:
 *
 *   accion;slug;destino;nombre;nuevo_slug
 *
 *   fusionar   slug → destino (slug del club que se queda). El slug viejo redirige.
 *   renombrar  slug → nombre y/o nuevo_slug. El slug viejo redirige.
 *   seleccion  los equipos del club son una selección: team_type='national' y sin club.
 *
 * Primero todas las fusiones, luego los renombrados (que pueden apuntar al
 * superviviente de una fusión) y por último las selecciones. Cada fila va en
 * su propia transacción: un error se informa y el resto sigue.
 *
 *   node dist/apps/etl/src/apply-club-plan.js --plan=/ruta/plan.csv            # dry-run
 *   node dist/apps/etl/src/apply-club-plan.js --plan=/ruta/plan.csv --write
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { withTransaction, closeDb, mergeClubsInTx, renameClubInTx, findClubIdBySlug } from '@sports/db';

export type PlanAction = 'fusionar' | 'renombrar' | 'seleccion';
export interface PlanRow { accion: PlanAction; slug: string; destino?: string; nombre?: string; nuevoSlug?: string }

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Lee el CSV del plan. Las filas sin acción se ignoran; las mal formadas lanzan con su línea. */
export function parsePlan(text: string): PlanRow[] {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim());
  const header = lines.shift()?.split(';').map((h) => h.trim().toLowerCase()) ?? [];
  const col = (name: string) => header.indexOf(name);
  for (const required of ['accion', 'slug']) {
    if (col(required) < 0) throw new Error(`falta la columna "${required}" en la cabecera`);
  }
  const rows: PlanRow[] = [];
  lines.forEach((line, i) => {
    const cells = line.split(';').map((c) => c.trim());
    const get = (name: string) => (col(name) >= 0 ? cells[col(name)] ?? '' : '');
    const accion = get('accion').toLowerCase();
    if (!accion) return;
    const where = `línea ${i + 2}`;
    const slug = get('slug');
    if (!SLUG_RE.test(slug)) throw new Error(`${where}: slug inválido "${slug}"`);
    if (accion === 'fusionar') {
      const destino = get('destino');
      if (!SLUG_RE.test(destino)) throw new Error(`${where}: destino inválido "${destino}"`);
      if (destino === slug) throw new Error(`${where}: destino igual que slug`);
      rows.push({ accion, slug, destino });
    } else if (accion === 'renombrar') {
      const nombre = get('nombre') || undefined;
      const nuevoSlug = get('nuevo_slug') || undefined;
      if (!nombre && !nuevoSlug) throw new Error(`${where}: renombrar sin nombre ni nuevo_slug`);
      if (nuevoSlug && !SLUG_RE.test(nuevoSlug)) throw new Error(`${where}: nuevo_slug inválido "${nuevoSlug}"`);
      rows.push({ accion, slug, ...(nombre ? { nombre } : {}), ...(nuevoSlug ? { nuevoSlug } : {}) });
    } else if (accion === 'seleccion') {
      rows.push({ accion, slug });
    } else {
      throw new Error(`${where}: acción desconocida "${accion}"`);
    }
  });
  const order: Record<PlanAction, number> = { fusionar: 0, renombrar: 1, seleccion: 2 };
  return rows.sort((a, b) => order[a.accion] - order[b.accion]);
}

export async function applyClubPlan(rows: PlanRow[], write: boolean): Promise<{ ok: number; errors: string[] }> {
  const errors: string[] = [];
  let ok = 0;
  for (const row of rows) {
    const label = `${row.accion} ${row.slug}${row.destino ? ` → ${row.destino}` : ''}${row.nuevoSlug ? ` → ${row.nuevoSlug}` : ''}${row.nombre ? ` ("${row.nombre}")` : ''}`;
    try {
      await withTransaction(async (client) => {
        const id = await findClubIdBySlug(row.slug, client);
        if (!id) throw new Error(`no existe el club "${row.slug}"`);
        if (row.accion === 'fusionar') {
          const intoId = await findClubIdBySlug(row.destino!, client);
          if (!intoId) throw new Error(`no existe el club destino "${row.destino}"`);
          if (intoId === id) return; // ya fusionado en una fila anterior
          await mergeClubsInTx(client, id, intoId);
        } else if (row.accion === 'renombrar') {
          await renameClubInTx(client, id, {
            ...(row.nombre ? { canonicalName: row.nombre } : {}),
            ...(row.nuevoSlug ? { slug: row.nuevoSlug } : {}),
          });
        } else {
          await client.query(
            `UPDATE teams SET team_type = 'national', club_id = NULL, updated_at = NOW() WHERE club_id = $1`, [id],
          );
        }
        if (!write) throw new DryRun();
      });
      ok++;
      console.log(`  ok    ${label}`);
    } catch (err) {
      if (err instanceof DryRun) { ok++; console.log(`  (dry) ${label}`); continue; }
      const msg = `${label}: ${err instanceof Error ? err.message : String(err)}`;
      errors.push(msg);
      console.log(`  ERROR ${msg}`);
    }
  }
  return { ok, errors };
}

/** Fuerza el ROLLBACK de cada fila en dry-run, para validar contra la BD real sin escribir. */
class DryRun extends Error {}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const planArg = process.argv.find((a) => a.startsWith('--plan='));
  const write = process.argv.includes('--write');
  if (!planArg) {
    console.error('uso: apply-club-plan --plan=/ruta/plan.csv [--write]');
    process.exit(2);
  }
  const rows = parsePlan(readFileSync(planArg.slice('--plan='.length), 'utf8'));
  console.log(`${rows.length} acciones (${write ? 'ESCRIBE' : 'dry-run: nada se guarda'})`);
  applyClubPlan(rows, write)
    .then(({ ok, errors }) => {
      console.log(`\n${ok} correctas, ${errors.length} con error`);
      process.exitCode = errors.length ? 1 : 0;
    })
    .finally(() => closeDb());
}
