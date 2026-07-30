/**
 * Snapshots del push-dispatcher: la "foto antes" que alimenta los diffs del
 * directo. La lógica de decisión (freshEvents/collapsePerScorer) ya tiene tests
 * puros en push-diff.test.ts; lo que aquí se protege son las reglas de las
 * CONSULTAS, que solo se pueden verificar contra Postgres real:
 *
 *   · snapshotMatches — qué partidos entran (ventana de ±4h, y los live SIEMPRE).
 *   · snapshotGoals — solo goal/penalty y solo CON goleador identificado.
 *   · snapshotEventsByType — el mismo motor pero SIN exigir jugador (roja/azul
 *     sin lanzador se segmentan por equipo).
 *
 * Si una migración o un refactor rompe una de estas ventanas/filtros, el push
 * en vivo fallaría o spamearía en silencio; estos tests lo cazan en CI.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { db, closeDb } from '@sports/db';
import {
  snapshotMatches, snapshotGoals, snapshotEventsByType,
} from '../../apps/etl/src/push-dispatcher.js';
import { limpiar } from './support/db.js';
import { crearPartido } from './support/factorias.js';

let n = 0;

async function crearJugador(sportId: string): Promise<string> {
  n += 1;
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO players (sport_id, first_name, last_name, slug)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [sportId, 'Nombre', `Apellido${n}`, `jugador-snap-${n}`],
  );
  return rows[0]!.id;
}

async function crearEvento(matchId: string, opts: {
  eventType: string;
  playerId?: string | null;
  teamId?: string | null;
  minute?: number | null;
  period?: number | null;
}): Promise<string> {
  n += 1;
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO match_events (match_id, event_type, player_id, team_id, minute, period, source_ref)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [matchId, opts.eventType, opts.playerId ?? null, opts.teamId ?? null,
      opts.minute ?? null, opts.period ?? null, `ev-snap-${n}`],
  );
  return rows[0]!.id;
}

beforeEach(async () => {
  await limpiar();
});

afterAll(async () => {
  await closeDb();
});

describe('snapshotMatches — ventana de partidos relevantes', () => {
  it('incluye los live (aunque sean viejos) y los scheduled dentro de ±4h; excluye los de fuera', async () => {
    // Live empezado hace 10 h: entra por ESTADO, no por ventana.
    const live = await crearPartido({ status: 'live', horasDesdeInicio: 10 });
    const { seasonId } = live;
    const pasadoCercano = await crearPartido({ seasonId, status: 'scheduled', horasDesdeInicio: 2 });   // hace 2 h
    const futuroCercano = await crearPartido({ seasonId, status: 'scheduled', horasDesdeInicio: -2 });  // en 2 h
    const lejano        = await crearPartido({ seasonId, status: 'scheduled', horasDesdeInicio: 10 });  // hace 10 h

    const snap = await snapshotMatches(seasonId);

    expect(snap.has(live.matchId)).toBe(true);
    expect(snap.has(pasadoCercano.matchId)).toBe(true);
    expect(snap.has(futuroCercano.matchId)).toBe(true);
    expect(snap.has(lejano.matchId)).toBe(false);
  });

  it('solo mira la temporada pedida', async () => {
    const a = await crearPartido({ status: 'live' });
    const b = await crearPartido({ status: 'live' });

    const snap = await snapshotMatches(a.seasonId);

    expect(snap.has(a.matchId)).toBe(true);
    expect(snap.has(b.matchId)).toBe(false);
  });
});

describe('snapshotGoals — solo goles/penaltis con goleador', () => {
  it('incluye goal y penalty con jugador; excluye el gol sin jugador y otros tipos', async () => {
    const { seasonId, matchId, sportId, homeTeamId } = await crearPartido({ status: 'live' });
    const jugador = await crearJugador(sportId);

    const gol       = await crearEvento(matchId, { eventType: 'goal',      playerId: jugador, teamId: homeTeamId, minute: 10, period: 1 });
    const penalti   = await crearEvento(matchId, { eventType: 'penalty',   playerId: jugador, teamId: homeTeamId, minute: 20, period: 2 });
    const golSinJug = await crearEvento(matchId, { eventType: 'goal',      playerId: null,    teamId: homeTeamId, minute: 5,  period: 1 });
    const azul      = await crearEvento(matchId, { eventType: 'blue_card', playerId: jugador, teamId: homeTeamId, minute: 12, period: 1 });

    const snap = await snapshotGoals([seasonId]);

    expect(snap.has(gol)).toBe(true);
    expect(snap.has(penalti)).toBe(true);
    expect(snap.has(golSinJug)).toBe(false); // requirePlayer: el gol sin goleador no entra
    expect(snap.has(azul)).toBe(false);      // una azul no es un gol
  });

  it('el snapshot lleva el goleador y el minuto reales del evento', async () => {
    const { seasonId, matchId, sportId, homeTeamId } = await crearPartido({ status: 'live' });
    const jugador = await crearJugador(sportId);
    const gol = await crearEvento(matchId, { eventType: 'goal', playerId: jugador, teamId: homeTeamId, minute: 33, period: 2 });

    const snap = await snapshotGoals([seasonId]);
    const g = snap.get(gol);

    expect(g).toBeDefined();
    expect(g!.playerId).toBe(jugador);
    expect(g!.minute).toBe(33);
    expect(g!.period).toBe(2);
  });
});

describe('snapshotEventsByType — no exige goleador', () => {
  it('incluye una roja sin jugador (se segmenta por equipo, no por lanzador)', async () => {
    const { seasonId, matchId, homeTeamId } = await crearPartido({ status: 'live' });
    const rojaSinJugador = await crearEvento(matchId, {
      eventType: 'red_card', playerId: null, teamId: homeTeamId, minute: 30, period: 2,
    });

    const snap = await snapshotEventsByType([seasonId], 'red_card');

    expect(snap.has(rojaSinJugador)).toBe(true);
  });

  it('filtra por el tipo pedido: una azul no aparece al pedir rojas', async () => {
    const { seasonId, matchId, sportId, homeTeamId } = await crearPartido({ status: 'live' });
    const jugador = await crearJugador(sportId);
    const azul = await crearEvento(matchId, {
      eventType: 'blue_card', playerId: jugador, teamId: homeTeamId, minute: 15, period: 1,
    });

    const snap = await snapshotEventsByType([seasonId], 'red_card');

    expect(snap.has(azul)).toBe(false);
  });
});
