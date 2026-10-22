/**
 * B4 — Cuelga una competición publicada aparte como fase o grupo de otra.
 *
 *   npx tsx apps/etl/src/attach-competition-phase.ts --child=<uuid> --parent=<uuid> --kind=knockout
 *   npx tsx apps/etl/src/attach-competition-phase.ts --child=<uuid> --parent=<uuid> --kind=groups --group=Sur --write
 *
 * Sin --write solo muestra el plan. Ver attachCompetitionAsPhase (packages/db).
 */
import { db, closeDb, attachCompetitionAsPhase } from '@sports/db';

function arg(name: string): string | undefined {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
}

async function main(): Promise<void> {
  const childId = arg('child');
  const parentId = arg('parent');
  const kind = (arg('kind') ?? 'knockout') as 'knockout' | 'groups' | 'league';
  const groupName = arg('group');
  const write = process.argv.includes('--write');
  if (!childId || !parentId) throw new Error('Uso: --child=<uuid> --parent=<uuid> [--kind=knockout|groups|league] [--group=Sur] [--write]');

  const names = await db.query<{ id: string; name: string }>(`SELECT id, name FROM competitions WHERE id = ANY($1)`, [[childId, parentId]]);
  const nombre = (id: string) => names.rows.find((r) => r.id === id)?.name ?? id;
  const plan = await attachCompetitionAsPhase({ childId, parentId, kind, ...(groupName ? { groupName } : {}), write });
  console.log(`${nombre(childId)} → fase ${kind}${groupName ? ` (grupo ${groupName})` : ''} de ${nombre(parentId)}`);
  for (const s of plan.seasons) console.log(`  ${s.name}: ${s.matches} partidos`);
  console.log(write ? 'Aplicado.' : '(dry-run) Repite con --write para aplicar.');
}

main()
  .catch((err) => { console.error(err instanceof Error ? err.message : err); process.exitCode = 1; })
  .finally(() => closeDb());
