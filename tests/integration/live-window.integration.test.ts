/**
 * live-window — la ventana de actividad del directo (#185).
 *
 * En el saque, la fuente (rfep_mc_1.php) aún no ha marcado el partido `live`, y
 * la ventana "upcoming" era estrictamente futura: el partido dejaba de contar y
 * el bucle de 45 s se cortaba justo al empezar. Se prueba que el pasado reciente
 * (margen) sostiene la ventana y el pasado lejano no.
 */
import { describe, test, expect, beforeEach, afterAll } from 'vitest';
import { db, closeDb } from '@sports/db';
import { limpiar } from './support/db.js';
import { crearDeporte, crearCompeticion, crearTemporada, crearEquipo } from './support/factorias.js';
import { checkWindow } from '../../apps/etl/src/live-window.js';

let sportId: string;
let seasonId: string;

beforeEach(async () => {
  await limpiar();
  sportId = await crearDeporte();
  const competitionId = await crearCompeticion(sportId);
  seasonId = await crearTemporada(competitionId, { esActual: true });
});

afterAll(async () => {
  await closeDb();
});

/** Inserta un partido 'scheduled' cuya hora es NOW() + `minutos`. */
async function programadoEn(minutos: number): Promise<void> {
  const home = await crearEquipo(sportId);
  const away = await crearEquipo(sportId);
  await db.query(
    `INSERT INTO matches (season_id, home_team_id, away_team_id, status, scheduled_at, source_ref)
     VALUES ($1,$2,$3,'scheduled', NOW() + make_interval(mins => $4), $5)`,
    [seasonId, home, away, minutos, `t-${minutos}-${Math.random()}`],
  );
}

describe('checkWindow (#185)', () => {
  test('T-031 el pasado reciente (saque) sostiene hasUpcoming', async () => {
    await programadoEn(-5); // hace 5 min: la fuente aún no lo marcó live
    const w = await checkWindow([seasonId], 2);
    expect(w.hasUpcoming).toBe(true);
  });

  test('T-031b el futuro próximo sigue contando como hasUpcoming', async () => {
    await programadoEn(60);
    expect((await checkWindow([seasonId], 2)).hasUpcoming).toBe(true);
  });

  test('partido que empieza TARDE: 45 min después de la hora prevista el bucle sigue vigilándolo', async () => {
    // Sin LIVE por reloj, lo que mantiene el directo atento a un saque retrasado
    // es la ventana: debe cubrir retrasos realistas, no solo el saque puntual.
    await programadoEn(-45);
    expect((await checkWindow([seasonId], 2)).hasUpcoming).toBe(true);
  });

  test('T-031c el pasado lejano no cuenta como upcoming (queda como overdue)', async () => {
    await programadoEn(-6 * 60);
    const w = await checkWindow([seasonId], 2);
    expect(w.hasUpcoming).toBe(false);
    expect(w.hasOverdue).toBe(true);
  });
});
