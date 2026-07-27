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
    const { rows } = await db.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes
        WHERE tablename = 'match_events' AND indexname = 'uq_match_events_match_source_ref'`
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.indexdef).toContain('UNIQUE');
    expect(rows[0]!.indexdef).toContain('source_ref IS NOT NULL');
  });
});
