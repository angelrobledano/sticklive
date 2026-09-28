import { describe, it, expect } from 'vitest';
import { isUuid } from './uuid.js';

describe('isUuid (#275)', () => {
  it('acepta UUIDs válidos en minúsculas', () => {
    expect(isUuid('00000000-0000-0000-0000-000000000000')).toBe(true);
    expect(isUuid('3f2504e0-4f89-41d3-9a0c-0305e82c3301')).toBe(true);
  });

  it('acepta mayúsculas y mezcla (case-insensitive)', () => {
    expect(isUuid('3F2504E0-4F89-41D3-9A0C-0305E82C3301')).toBe(true);
    expect(isUuid('3f2504E0-4f89-41d3-9A0c-0305e82c3301')).toBe(true);
  });

  it('rechaza ids que no son UUID', () => {
    for (const bad of ['not-a-uuid', '123', '', 'undefined', 'null', 'abc']) {
      expect(isUuid(bad), bad).toBe(false);
    }
  });

  it('rechaza UUIDs malformados (longitud, guiones o hex fuera de rango)', () => {
    expect(isUuid('3f2504e0-4f89-41d3-9a0c-0305e82c330')).toBe(false);   // un carácter de menos
    expect(isUuid('3f2504e0-4f89-41d3-9a0c-0305e82c33012')).toBe(false); // un carácter de más
    expect(isUuid('3f2504e04f8941d39a0c0305e82c3301')).toBe(false);      // sin guiones
    expect(isUuid('3f2504e0-4f89-41d3-9a0c-0305e82c33g1')).toBe(false);  // 'g' no es hex
    expect(isUuid('g3f2504e-4f89-41d3-9a0c-0305e82c3301')).toBe(false);
  });

  it('rechaza espacios alrededor (no recorta): un id de ruta no se normaliza', () => {
    expect(isUuid(' 3f2504e0-4f89-41d3-9a0c-0305e82c3301')).toBe(false);
    expect(isUuid('3f2504e0-4f89-41d3-9a0c-0305e82c3301 ')).toBe(false);
    expect(isUuid('\t3f2504e0-4f89-41d3-9a0c-0305e82c3301\n')).toBe(false);
  });

  it('rechaza valores que no son strings', () => {
    expect(isUuid(undefined)).toBe(false);
    expect(isUuid(null)).toBe(false);
    expect(isUuid(123)).toBe(false);
    expect(isUuid({})).toBe(false);
  });
});
