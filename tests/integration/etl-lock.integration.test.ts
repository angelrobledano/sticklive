/**
 * Lock global de ingesta (#317) — exclusión mutua entre procesos vía
 * pg_try_advisory_lock con cliente dedicado. Es la pieza que cierra el hueco
 * del flock local: dos CONTENEDORES distintos ya no pueden escribir el mismo
 * feed a la vez.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { closeDb } from '@sports/db';
import { acquireEtlLock } from '../../apps/etl/src/etl-lock.js';
import { limpiar } from './support/db.js';

beforeEach(async () => { await limpiar(); });
afterAll(async () => { await closeDb(); });

describe('acquireEtlLock', () => {
  it('exclusión mutua: el segundo intento mientras se sostiene devuelve null', async () => {
    const lock = await acquireEtlLock();
    expect(lock).not.toBeNull();

    const otro = await acquireEtlLock();
    expect(otro).toBeNull();

    await lock!.release();
  });

  it('tras liberar, el lock vuelve a estar disponible', async () => {
    const primero = await acquireEtlLock();
    expect(primero).not.toBeNull();
    await primero!.release();

    const segundo = await acquireEtlLock();
    expect(segundo).not.toBeNull();
    await segundo!.release();
  });

  it('release es idempotente (doble release no revienta)', async () => {
    const lock = await acquireEtlLock();
    expect(lock).not.toBeNull();
    await lock!.release();
    await expect(lock!.release()).resolves.toBeUndefined();
  });
});
