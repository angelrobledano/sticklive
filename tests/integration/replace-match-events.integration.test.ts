/**
 * `replaceMatchEvents` — el upsert idempotente de eventos de partido.
 *
 * Es LA función crítica del directo: corre cada 45 segundos por cada partido en
 * juego, y el push de goles se calcula comparando el estado anterior con el
 * nuevo. Si los ids de evento cambian entre ejecuciones, el diff cree que todo
 * es nuevo y **vuelve a notificar cada gol en cada ciclo**.
 *
 * Eso no es hipotético: pasó. La versión anterior hacía DELETE + INSERT, así
 * que todos los ids cambiaban siempre, y los `source_ref` eran posicionales
 * (`fep_event_{idp}_row{n}`) mientras el acta se ordena de más nuevo a más
 * viejo — o sea que cambiaban en cada scrape. Se midieron 18 de 18 refs
 * distintas entre dos capturas del mismo partido. De ahí las migraciones
 * 034 (índice único parcial), 035 y 036 (refs derivadas del contenido).
 *
 * Estos tests existen para que eso no pueda volver sin que salte algo.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { db, closeDb, replaceMatchEvents } from '@sports/db';
import { limpiar } from './support/db.js';
import { crearPartido, crearFuente, eventosDe, type EscenarioPartido } from './support/factorias.js';

let escenario: EscenarioPartido;
let sourceId: string;

/** Un evento como los que produce el parser de actas. */
function evento(sourceRef: string, extra: Partial<{
  eventType: string; minute: number; period: number; clock: string; detail: string;
}> = {}) {
  return {
    teamId: escenario.homeTeamId,
    playerId: null,
    eventType: (extra.eventType ?? 'goal') as 'goal',
    minute: extra.minute ?? 10,
    period: extra.period ?? 1,
    clock: extra.clock ?? '15:00',
    detail: extra.detail ?? null,
    sourceId,
    sourceRef,
    scrapedAt: new Date(),
  };
}

beforeAll(async () => {
  sourceId = await crearFuente();
});

beforeEach(async () => {
  await limpiar();
  sourceId = await crearFuente();
  escenario = await crearPartido({ status: 'live' });
});

afterAll(async () => {
  await closeDb();
});

describe('replaceMatchEvents', () => {
  it('inserta los eventos de una acta nueva', async () => {
    await replaceMatchEvents(escenario.matchId, [
      evento('fep_event_1_p1_1500_goal_H', { minute: 10 }),
      evento('fep_event_1_p2_0730_goal_H', { minute: 33, period: 2 }),
    ]);

    const eventos = await eventosDe(escenario.matchId);
    expect(eventos).toHaveLength(2);
    expect(eventos.map((e) => e.sourceRef)).toEqual([
      'fep_event_1_p1_1500_goal_H',
      'fep_event_1_p2_0730_goal_H',
    ]);
  });

  it('reprocesar la MISMA acta no duplica ni cambia los ids', async () => {
    // Este es el test que importa. Si falla, el push vuelve a notificar cada
    // gol cada 45 segundos.
    const acta = [
      evento('fep_event_1_p1_1500_goal_H', { minute: 10 }),
      evento('fep_event_1_p2_0730_goal_H', { minute: 33, period: 2 }),
    ];

    await replaceMatchEvents(escenario.matchId, acta);
    const primera = await eventosDe(escenario.matchId);

    await replaceMatchEvents(escenario.matchId, acta);
    const segunda = await eventosDe(escenario.matchId);

    expect(segunda).toHaveLength(2);
    expect(segunda.map((e) => e.id)).toEqual(primera.map((e) => e.id));
  });

  it('los ids sobreviven a que el acta llegue REORDENADA', async () => {
    // El acta de sidgad se ordena de más nuevo a más viejo, así que el orden
    // de las filas cambia según avanza el partido. Con refs posicionales esto
    // rompía; con refs de contenido, no.
    const a = evento('fep_event_1_p1_1500_goal_H', { minute: 10 });
    const b = evento('fep_event_1_p2_0730_goal_H', { minute: 33, period: 2 });

    await replaceMatchEvents(escenario.matchId, [a, b]);
    const primera = await eventosDe(escenario.matchId);

    await replaceMatchEvents(escenario.matchId, [b, a]); // mismo contenido, orden inverso
    const segunda = await eventosDe(escenario.matchId);

    expect(segunda.map((e) => e.id)).toEqual(primera.map((e) => e.id));
  });

  it('actualiza los datos de un evento sin cambiar su id', async () => {
    // Corrección típica del acta: el mismo evento con el minuto corregido.
    await replaceMatchEvents(escenario.matchId, [
      evento('fep_event_1_p1_1500_goal_H', { minute: 10, detail: 'sin confirmar' }),
    ]);
    const [antes] = await eventosDe(escenario.matchId);

    await replaceMatchEvents(escenario.matchId, [
      evento('fep_event_1_p1_1500_goal_H', { minute: 11, detail: 'confirmado' }),
    ]);
    const [despues] = await eventosDe(escenario.matchId);

    expect(despues!.id).toBe(antes!.id);
    expect(despues!.minute).toBe(11);
  });

  it('borra los eventos que el acta ya no lista', async () => {
    await replaceMatchEvents(escenario.matchId, [
      evento('fep_event_1_p1_1500_goal_H'),
      evento('fep_event_1_p1_1200_goal_H', { clock: '12:00' }),
    ]);
    expect(await eventosDe(escenario.matchId)).toHaveLength(2);

    // El acta se corrige y uno de los goles desaparece (anulado).
    await replaceMatchEvents(escenario.matchId, [evento('fep_event_1_p1_1500_goal_H')]);

    const eventos = await eventosDe(escenario.matchId);
    expect(eventos).toHaveLength(1);
    expect(eventos[0]!.sourceRef).toBe('fep_event_1_p1_1500_goal_H');
  });

  it('con un acta vacía borra todo', async () => {
    await replaceMatchEvents(escenario.matchId, [evento('fep_event_1_p1_1500_goal_H')]);
    await replaceMatchEvents(escenario.matchId, []);
    expect(await eventosDe(escenario.matchId)).toHaveLength(0);
  });

  it('deduplica refs repetidas dentro de la misma llamada', async () => {
    // Postgres rechaza que un ON CONFLICT DO UPDATE toque la misma fila dos
    // veces en una sentencia ("cannot affect row a second time"). Sin la
    // deduplicación previa, esto reventaría en vez de insertar.
    await expect(
      replaceMatchEvents(escenario.matchId, [
        evento('fep_event_1_p1_1500_goal_H', { minute: 10 }),
        evento('fep_event_1_p1_1500_goal_H', { minute: 12 }), // misma ref
      ])
    ).resolves.not.toThrow();

    const eventos = await eventosDe(escenario.matchId);
    expect(eventos).toHaveLength(1);
    expect(eventos[0]!.minute).toBe(12); // gana la última
  });

  it('no mezcla eventos de partidos distintos con la misma ref', async () => {
    // El índice único es (match_id, source_ref), no sólo source_ref: dos
    // partidos pueden tener refs iguales sin pisarse.
    const otro = await crearPartido({ status: 'live' });

    await replaceMatchEvents(escenario.matchId, [evento('fep_event_1_p1_1500_goal_H')]);
    await replaceMatchEvents(otro.matchId, [{
      ...evento('fep_event_1_p1_1500_goal_H'),
      teamId: otro.homeTeamId,
    }]);

    expect(await eventosDe(escenario.matchId)).toHaveLength(1);
    expect(await eventosDe(otro.matchId)).toHaveLength(1);
  });

  it('el índice único parcial de la migración 034 existe y es el que se usa', async () => {
    // Si este índice desaparece, el ON CONFLICT deja de tener destino y todo
    // lo de arriba falla de forma críptica. Mejor que se diga aquí.
    // Desde la 047 la tabla es particionada y match_date entra en la clave.
    const { rows } = await db.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes
        WHERE tablename = 'match_events' AND indexname = 'uq_match_events_match_source_ref'`
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.indexdef).toContain('UNIQUE');
    expect(rows[0]!.indexdef).toContain('source_ref IS NOT NULL');
    expect(rows[0]!.indexdef).toContain('match_date');
  });
});

describe('particionado de match_events (migración 047)', () => {
  // Mismo montaje que el bloque de arriba: `evento()` usa `escenario`, así que
  // hay que refrescarlo tras el limpiar() (si no, apuntaría a un equipo ya
  // truncado y el INSERT violaría la FK).
  beforeEach(async () => {
    await limpiar();
    sourceId = await crearFuente();
    escenario = await crearPartido({ status: 'live' });
  });

  it('match_events es una tabla particionada por RANGE', async () => {
    const { rows } = await db.query<{ partstrat: string }>(
      `SELECT partstrat FROM pg_partitioned_table
         WHERE partrelid = 'match_events'::regclass`
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.partstrat).toBe('r'); // 'r' = RANGE
  });

  it('un evento aterriza en la partición de la temporada del partido', async () => {
    // crearPartido usa scheduled_at = NOW(): cae en la temporada actual.
    await replaceMatchEvents(escenario.matchId, [evento('fep_event_1_p1_1500_goal_H')]);

    const { rows } = await db.query<{ particion: string }>(
      `SELECT tableoid::regclass::text AS particion
         FROM match_events WHERE match_id = $1`,
      [escenario.matchId]
    );
    expect(rows).toHaveLength(1);
    // Nombre de partición estacional: match_events_sYYYY (no el centinela).
    expect(rows[0]!.particion).toMatch(/match_events_s\d{4}$/);
  });

  it('pasar match_date poda a una sola partición (no barre todas)', async () => {
    await replaceMatchEvents(escenario.matchId, [evento('fep_event_1_p1_1500_goal_H')]);

    // Fecha literal (poda en tiempo de plan). Un EXPLAIN que barre todas listaría
    // decenas de particiones; con match_date debe quedar una sola exploración.
    const { rows } = await db.query<{ 'QUERY PLAN': string }>(
      `EXPLAIN (COSTS OFF)
         SELECT * FROM match_events
          WHERE match_id = $1 AND match_date = CURRENT_DATE`,
      [escenario.matchId]
    );
    const plan = rows.map((r) => r['QUERY PLAN']).join('\n');
    // El nombre de la partición aparece más de una vez por línea (relación +
    // índice), así que contamos particiones DISTINTAS.
    const particiones = new Set(plan.match(/match_events_s\d{4}/g) ?? []);
    expect(particiones.size).toBe(1);
  });

  it('DETACH saca una temporada del árbol sin borrar el resto', async () => {
    // Fechamos el partido en una temporada PASADA sin uso (2005/06): así el
    // DROP de su partición no afecta a la temporada actual, que es la que usan
    // el resto de tests (comparten la misma BD). Si aquí se dropease la
    // partición de "hoy", cualquier test posterior que cree un partido actual
    // fallaría con "no partition found".
    await db.query(
      `UPDATE matches SET scheduled_at = '2005-11-10T18:00:00Z' WHERE id = $1`,
      [escenario.matchId]
    );
    await replaceMatchEvents(escenario.matchId, [evento('fep_event_1_p1_1500_goal_H')]);

    const { rows: pr } = await db.query<{ particion: string }>(
      `SELECT tableoid::regclass::text AS particion
         FROM match_events WHERE match_id = $1 LIMIT 1`,
      [escenario.matchId]
    );
    const particion = pr[0]!.particion;
    expect(particion).toBe('match_events_s2005');

    await db.query(`ALTER TABLE match_events DETACH PARTITION ${particion}`);
    // Ya no se ve desde el padre...
    expect(await eventosDe(escenario.matchId)).toHaveLength(0);
    // ...pero el dato sigue existiendo en la partición desacoplada.
    const { rows: cnt } = await db.query<{ n: string }>(
      `SELECT count(*) AS n FROM ${particion}`
    );
    expect(Number(cnt[0]!.n)).toBe(1);

    // Se elimina la partición desacoplada (temporada sin uso) para no dejar una
    // tabla suelta que el TRUNCATE del padre ya no cubre.
    await db.query(`DROP TABLE ${particion}`);
  });

  it('#149 una ficha VACÍA (parseo roto) no borra la cronología ya cargada', async () => {
    await replaceMatchEvents(escenario.matchId, [
      evento('fep_event_a'),
      evento('fep_event_b', { minute: 20 }),
    ]);
    expect(await eventosDe(escenario.matchId)).toHaveLength(2);

    // La ficha llega sin eventos: se conserva lo que había (los malos datos son
    // peores que no tener datos) en vez de vaciar el timeline.
    await replaceMatchEvents(escenario.matchId, []);
    expect(await eventosDe(escenario.matchId)).toHaveLength(2);
  });
});
