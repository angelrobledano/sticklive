import { describe, it, expect } from 'vitest';
import { lookupImageUrl } from './image-url.js';

/**
 * Un hipo de Postgres no debe convertir el 404 esperado en un 500 ni colgar la
 * petición del escudo/foto (incidente 2026-10-05): si la consulta falla o tarda
 * de más, se trata como "sin imagen" y el cliente usa su fallback.
 */
describe('lookupImageUrl', () => {
  it('devuelve la URL cuando la consulta resuelve', async () => {
    const url = await lookupImageUrl(async () => 'https://cdn.test/logo.png');
    expect(url).toBe('https://cdn.test/logo.png');
  });

  it('devuelve null cuando la consulta no encuentra nada', async () => {
    expect(await lookupImageUrl(async () => null)).toBeNull();
  });

  it('devuelve null (sin propagar) cuando la consulta lanza', async () => {
    const url = await lookupImageUrl(async () => {
      throw new Error('Connection terminated due to connection timeout');
    });
    expect(url).toBeNull();
  });

  it('devuelve null cuando la consulta tarda más que el timeout', async () => {
    const url = await lookupImageUrl(
      () => new Promise<string | null>((resolve) => setTimeout(() => resolve('tarde'), 1000)),
      20,
    );
    expect(url).toBeNull();
  });

  it('no deja una promesa rechazada sin manejar si el timeout gana', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
    process.on('unhandledRejection', onUnhandled);
    try {
      await lookupImageUrl(
        () => new Promise<string | null>((_, reject) => setTimeout(() => reject(new Error('boom')), 40)),
        10,
      );
      // Deja que se dispare el rechazo tardío antes de comprobar.
      await new Promise((resolve) => setTimeout(resolve, 80));
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });
});
