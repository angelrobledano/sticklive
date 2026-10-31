/**
 * Partidos aplazados o cambiados de día (2026-10-31): el upsert sigue la fecha
 * nueva de la fuente y un aplazado con día nuevo vuelve a programado.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { db, closeDb, upsertMatch } from '@sports/db';
import { limpiar } from './support/db.js';
import { crearDeporte, crearCompeticion, crearTemporada, crearEquipo } from './support/factorias.js';

beforeEach(async () => { await limpiar(); });
afterAll(async () => { await closeDb(); });

async function base() {
  const sportId = await crearDeporte();
  const seasonId = await crearTemporada(await crearCompeticion(sportId));
  return { seasonId, homeTeamId: await crearEquipo(sportId), awayTeamId: await crearEquipo(sportId), sourceRef: 'fep_rs_1' };
}

const leer = async (ref: string) =>
  (await db.query<{ status: string; scheduled_at: Date }>(`SELECT status, scheduled_at FROM matches WHERE source_ref = $1`, [ref])).rows[0]!;

const dias = (n: number) => new Date(Date.now() + n * 86_400_000);

describe('cambios de fecha y aplazamientos', () => {
  it('cambio de día: se guarda la fecha nueva', async () => {
    const b = await base();
    await upsertMatch({ ...b, scheduledAt: dias(3) });
    await upsertMatch({ ...b, scheduledAt: dias(10) });
    const nueva = dias(10);
    await upsertMatch({ ...b, scheduledAt: nueva });
    expect(Math.abs((await leer(b.sourceRef)).scheduled_at.getTime() - nueva.getTime())).toBeLessThan(1000);
  });

  it('aplazado y luego con día nuevo sin estado en la fuente → programado', async () => {
    const b = await base();
    await upsertMatch({ ...b, scheduledAt: dias(3) });
    await upsertMatch({ ...b, scheduledAt: dias(3), status: 'postponed' });
    expect((await leer(b.sourceRef)).status).toBe('postponed');
    await upsertMatch({ ...b, scheduledAt: dias(20) });
    expect((await leer(b.sourceRef)).status).toBe('scheduled');
  });

  it('aplazado sin fecha nueva sigue aplazado', async () => {
    const b = await base();
    const d = dias(3);
    await upsertMatch({ ...b, scheduledAt: d, status: 'postponed' });
    await upsertMatch({ ...b, scheduledAt: d });
    expect((await leer(b.sourceRef)).status).toBe('postponed');
  });

  it('si la fuente dice aplazado con otra fecha, manda la fuente', async () => {
    const b = await base();
    await upsertMatch({ ...b, scheduledAt: dias(3), status: 'postponed' });
    await upsertMatch({ ...b, scheduledAt: dias(9), status: 'postponed' });
    expect((await leer(b.sourceRef)).status).toBe('postponed');
  });
});
