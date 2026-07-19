/**
 * Verificación determinista de `replaceMatchEvents` (migración 034, PR #36).
 *
 * Ejercita la función REAL de producción contra Postgres con eventos
 * sintéticos. Sin red, sin scraper, sin depender de que la fuente siga
 * sirviendo un acta de hace meses: lo que se está probando es el SQL.
 *
 * Comprueba tres cosas:
 *
 *   1. IDEMPOTENCIA — reescribir el mismo listado conserva el `id` de cada
 *      evento. Es lo que hace correcto el diff por id del push-dispatcher.
 *   2. ESCRITURA REAL — `scraped_at` avanza en cada pasada. Sin esto, "los ids
 *      no cambian" podría significar simplemente que no se ejecutó nada.
 *   3. CORRECCIONES DEL ACTA — si la fuente quita un evento, añade otro y
 *      modifica un tercero, los supervivientes conservan su id, el eliminado
 *      desaparece y el nuevo entra. Es el caso que el diff por CONTEO perdía.
 *
 * Todo ocurre dentro de una transacción que se revierte al final: la BD queda
 * exactamente como estaba.
 *
 * Uso:
 *   npx tsx --env-file=.env packages/db/scripts/verify-event-upsert.ts
 */
import { db, withTransaction, replaceMatchEvents, closeDb } from '../src/index.js';
import type { UpsertMatchEventInput } from '../src/index.js';

const PREFIX = 'verify034';

/** Error centinela: fuerza el ROLLBACK sin que se interprete como fallo. */
class Rollback extends Error {}

function ev(n: number, over: Partial<UpsertMatchEventInput> = {}): UpsertMatchEventInput {
  return {
    eventType: 'goal',
    minute: n,
    period: 1,
    clock: null,
    teamId: null,
    playerId: null,
    detail: `sintetico ${n}`,
    sourceRef: `${PREFIX}_${n}`,
    scrapedAt: new Date(),
    ...over,
  };
}

interface Row { id: string; source_ref: string; minute: number | null; detail: string | null; scraped_at: Date | null }

const fail = (msg: string): never => { throw new Error(msg); };
const ok = (msg: string) => console.log(`  \x1b[32m✓\x1b[0m ${msg}`);

async function main() {
  // Cualquier partido sirve: sus eventos reales se restauran con el ROLLBACK.
  const m = await db.query<{ id: string }>('SELECT id FROM matches LIMIT 1');
  const matchId = m.rows[0]?.id ?? fail('No hay ni un partido en la BD');

  console.log(`\n\x1b[36m→ Verificando replaceMatchEvents sobre el partido ${matchId}\x1b[0m`);
  console.log('  (todo dentro de una transacción que se revierte al final)\n');

  try {
    await withTransaction(async (client) => {
      const read = async (): Promise<Map<string, Row>> => {
        const r = await client.query<Row>(
          `SELECT id, source_ref, minute, detail, scraped_at
             FROM match_events
            WHERE match_id = $1 AND source_ref LIKE '${PREFIX}_%'
            ORDER BY source_ref`,
          [matchId]
        );
        return new Map(r.rows.map((x) => [x.source_ref, x]));
      };

      // Partimos de un partido sin eventos previos para aislar la prueba.
      await client.query('DELETE FROM match_events WHERE match_id = $1', [matchId]);

      // ── 1ª pasada: inserción inicial ──────────────────────────────────────
      const listado = [ev(1), ev(2), ev(3), ev(4), ev(5)];
      await replaceMatchEvents(matchId, listado, client);
      const a = await read();
      if (a.size !== 5) fail(`Esperaba 5 eventos tras la inserción, hay ${a.size}`);
      ok(`Inserción inicial: ${a.size} eventos`);

      // ── 2ª pasada: mismo listado ──────────────────────────────────────────
      // Aquí se juega el ON CONFLICT contra el índice PARCIAL. Si la inferencia
      // del índice fuese incorrecta, esto reventaría o duplicaría filas.
      await new Promise((r) => setTimeout(r, 50)); // que scraped_at pueda avanzar
      await replaceMatchEvents(matchId, listado.map((e) => ({ ...e, scrapedAt: new Date() })), client);
      const b = await read();

      if (b.size !== 5) fail(`Tras reescribir el mismo listado hay ${b.size} eventos, esperaba 5`);
      for (const [ref, before] of a) {
        const after = b.get(ref) ?? fail(`Desapareció ${ref} al reescribir el mismo listado`);
        if (after.id !== before.id) {
          fail(`El id de ${ref} CAMBIÓ (${before.id} → ${after.id}): el upsert no está funcionando`);
        }
      }
      ok('Idempotencia: los 5 ids se conservan al reescribir el mismo listado');

      const advanced = [...b.values()].every((r) => {
        const prev = a.get(r.source_ref)!.scraped_at;
        return r.scraped_at !== null && prev !== null && r.scraped_at.getTime() > prev.getTime();
      });
      if (!advanced) fail('scraped_at NO avanzó: el UPDATE del ON CONFLICT no se ejecutó');
      ok('Escritura real: scraped_at avanzó en todas las filas');

      // ── 3ª pasada: la fuente corrige el acta ──────────────────────────────
      // Quita el 2, cambia el minuto del 3, añade el 6. Es exactamente el caso
      // que el diff por conteo no detectaba cuando se compensaban entre sí.
      const corregido = [ev(1), ev(3, { minute: 99, detail: 'corregido' }), ev(4), ev(5), ev(6)];
      await replaceMatchEvents(matchId, corregido, client);
      const c = await read();

      if (c.size !== 5) fail(`Tras la corrección hay ${c.size} eventos, esperaba 5`);
      if (c.has(`${PREFIX}_2`)) fail('El evento eliminado por la fuente sigue en la BD');
      for (const ref of [`${PREFIX}_1`, `${PREFIX}_3`, `${PREFIX}_4`, `${PREFIX}_5`]) {
        if (c.get(ref)!.id !== b.get(ref)!.id) {
          fail(`${ref} cambió de id durante una corrección que no le afectaba`);
        }
      }
      ok('Corrección del acta: supervivientes con id intacto, eliminado fuera');

      const nuevo = c.get(`${PREFIX}_6`) ?? fail('El evento nuevo no se insertó');
      if ([...b.values()].some((r) => r.id === nuevo.id)) fail('El evento nuevo reutilizó un id anterior');
      ok('El evento nuevo entra con id propio (el diff por id lo verá)');

      const tres = c.get(`${PREFIX}_3`)!;
      if (tres.minute !== 99 || tres.detail !== 'corregido') {
        fail('El evento corregido no actualizó sus campos');
      }
      ok('El evento corregido actualizó sus campos conservando el id');

      // Y que el índice único hace su trabajo.
      const dupes = await client.query<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM (
           SELECT match_id, source_ref FROM match_events
            WHERE match_id = $1 GROUP BY match_id, source_ref HAVING COUNT(*) > 1) d`,
        [matchId]
      );
      if (dupes.rows[0]?.n !== '0') fail(`Hay ${dupes.rows[0]?.n} duplicados de (match_id, source_ref)`);
      ok('Sin duplicados de (match_id, source_ref)');

      throw new Rollback(); // deshace TODO lo anterior
    });
  } catch (err) {
    if (!(err instanceof Rollback)) throw err;
  }

  const left = await db.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM match_events WHERE source_ref LIKE '${PREFIX}_%'`
  );
  if (left.rows[0]?.n !== '0') fail('El rollback no limpió los eventos sintéticos');
  ok('Rollback correcto: la BD queda como estaba');

  console.log('\n\x1b[32m✅ replaceMatchEvents es idempotente y conserva los ids.\x1b[0m\n');
}

main()
  .catch((err) => {
    console.error(`\n\x1b[31m✗ ${err instanceof Error ? err.message : String(err)}\x1b[0m\n`);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
