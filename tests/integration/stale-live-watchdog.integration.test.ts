/**
 * `sweepStaleLive` — la red de seguridad contra partidos fantasma "EN JUEGO".
 *
 * Escrita el 21/07/2026 a raíz de que los partidos del Europeo Sub-17 se
 * quedaran en directo cuatro horas después de terminar. Fue a producción sin
 * un solo test, porque no había forma de probar contra Postgres. Esto lo
 * arregla.
 *
 * Lo que hay que garantizar es tan importante por arriba como por abajo: que
 * limpie lo colgado, pero sobre todo que **no toque un partido en juego de
 * verdad**. Un falso positivo aquí saca de la portada un partido que se está
 * jugando, que es peor que el problema original.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { db, closeDb } from '@sports/db';
import { sweepStaleLive } from '../../apps/etl/src/stale-live-watchdog.js';
import { limpiar } from './support/db.js';
import { crearPartido } from './support/factorias.js';

async function estadoDe(matchId: string): Promise<string> {
  const { rows } = await db.query<{ status: string }>(
    'SELECT status FROM matches WHERE id = $1', [matchId]
  );
  return rows[0]!.status;
}

beforeEach(async () => {
  await limpiar();
});

afterAll(async () => {
  await closeDb();
});

describe('sweepStaleLive', () => {
  it('degrada a scheduled un partido colgado en live', async () => {
    // 6 horas: por encima del umbral por defecto (5).
    const p = await crearPartido({ status: 'live', horasDesdeInicio: 6 });

    const tocados = await sweepStaleLive([p.seasonId]);

    expect(tocados).toHaveLength(1);
    expect(tocados[0]!.id).toBe(p.matchId);
    expect(await estadoDe(p.matchId)).toBe('scheduled');
  });

  it('NO toca un partido que lleva poco en juego', async () => {
    // El caso que de verdad da miedo: un partido real, en directo, con
    // prórroga y penaltis. Dos horas no se acercan al umbral.
    const p = await crearPartido({ status: 'live', horasDesdeInicio: 2 });

    const tocados = await sweepStaleLive([p.seasonId]);

    expect(tocados).toHaveLength(0);
    expect(await estadoDe(p.matchId)).toBe('live');
  });

  it('NO toca un partido que EMPEZÓ tarde: cuenta desde el saque real, no desde la hora prevista', async () => {
    // Previsto hace 6 h pero la fuente lo dio en juego hace 1 h (retraso, hora
    // mal publicada…): está en juego de verdad.
    const p = await crearPartido({ status: 'live', horasDesdeInicio: 6 });
    await db.query(`UPDATE matches SET started_at = NOW() - INTERVAL '1 hour' WHERE id = $1`, [p.matchId]);

    expect(await sweepStaleLive([p.seasonId])).toHaveLength(0);
    expect(await estadoDe(p.matchId)).toBe('live');
  });

  it('no toca partidos que no están en live, por viejos que sean', async () => {
    const finalizado = await crearPartido({ status: 'finished', horasDesdeInicio: 200 });
    const programado = await crearPartido({ status: 'scheduled', horasDesdeInicio: 200 });

    await sweepStaleLive([finalizado.seasonId, programado.seasonId]);

    expect(await estadoDe(finalizado.matchId)).toBe('finished');
    expect(await estadoDe(programado.matchId)).toBe('scheduled');
  });

  it('se limita a las temporadas que se le pasan', async () => {
    const dentro = await crearPartido({ status: 'live', horasDesdeInicio: 8 });
    const fuera  = await crearPartido({ status: 'live', horasDesdeInicio: 8 });

    const tocados = await sweepStaleLive([dentro.seasonId]);

    expect(tocados.map((t) => t.id)).toEqual([dentro.matchId]);
    expect(await estadoDe(fuera.matchId)).toBe('live');
  });

  it('devuelve el nombre de la competición, que es lo que se manda a Sentry', async () => {
    const p = await crearPartido({ status: 'live', horasDesdeInicio: 7 });

    const [tocado] = await sweepStaleLive([p.seasonId]);

    // Sin esto el aviso diría "1 partido colgado" sin decir de dónde, y habría
    // que ir a la base a averiguarlo.
    expect(tocado!.competition).toBeTruthy();
    expect(tocado!.scheduledAt).toBeTruthy();
  });

  it('es idempotente: la segunda pasada no encuentra nada', async () => {
    const p = await crearPartido({ status: 'live', horasDesdeInicio: 9 });

    expect(await sweepStaleLive([p.seasonId])).toHaveLength(1);
    expect(await sweepStaleLive([p.seasonId])).toHaveLength(0);
  });

  it('con una lista de temporadas vacía no revienta ni toca nada', async () => {
    const p = await crearPartido({ status: 'live', horasDesdeInicio: 9 });

    const tocados = await sweepStaleLive([]);

    expect(tocados).toHaveLength(0);
    expect(await estadoDe(p.matchId)).toBe('live');
  });
});
