import { describe, expect, it } from 'vitest';

import { insertNativeAdPositions } from './nativeFeed.js';

describe('insertNativeAdPositions', () => {
  it('lista corta (< everyNItems) ⇒ sin inserción', () => {
    expect(insertNativeAdPositions(0, 8)).toEqual([]);
    expect(insertNativeAdPositions(5, 8)).toEqual([]);
    expect(insertNativeAdPositions(7, 8)).toEqual([]);
  });

  it('lista de 20 items cada 8 ⇒ un único punto: tras el item 8', () => {
    expect(insertNativeAdPositions(20, 8)).toEqual([8]);
  });

  it('config no cargada o disabled (undefined/null) ⇒ sin items sintéticos', () => {
    expect(insertNativeAdPositions(20, undefined)).toEqual([]);
    expect(insertNativeAdPositions(20, null)).toEqual([]);
  });

  it('everyNItems 1 se ACOTA a un único punto (v1: un solo native por pantalla)', () => {
    // El patrón "cada N" continuaría en [2, 3, ...]: v1 solo el primero.
    expect(insertNativeAdPositions(20, 1)).toEqual([1]);
  });

  it('everyNItems basura (0, negativo, decimal, NaN) ⇒ [] (fail-safe, malos datos peores)', () => {
    expect(insertNativeAdPositions(20, 0)).toEqual([]);
    expect(insertNativeAdPositions(20, -8)).toEqual([]);
    expect(insertNativeAdPositions(20, 2.5)).toEqual([]);
    expect(insertNativeAdPositions(20, Number.NaN)).toEqual([]);
  });

  it('exactamente everyNItems items ⇒ sí inserta (el anuncio cierra la lista)', () => {
    expect(insertNativeAdPositions(8, 8)).toEqual([8]);
  });
});
