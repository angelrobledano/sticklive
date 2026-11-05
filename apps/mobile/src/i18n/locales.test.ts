import { describe, expect, it } from 'vitest';
import { LOCALES, dictionaries, interpolate, resolveKey } from './locales';

describe('locales', () => {
  it('carga los 6 idiomas de la web', () => {
    expect(LOCALES).toEqual(['ca', 'en', 'es', 'fr', 'it', 'pt']);
  });

  it('todos los diccionarios exponen el mismo conjunto de claves', () => {
    const keySet = (o: unknown, prefix = ''): string[] =>
      Object.entries(o as Record<string, unknown>).flatMap(([k, v]) =>
        typeof v === 'object' && v !== null ? keySet(v, `${prefix}${k}.`) : [`${prefix}${k}`],
      );
    const es = keySet(dictionaries.es).sort();
    for (const loc of LOCALES) {
      expect(keySet(dictionaries[loc]).sort()).toEqual(es);
    }
  });

  it('resuelve claves anidadas y hace fallback a la clave si no existe', () => {
    expect(resolveKey(dictionaries.es, 'match_states.final')).toBe('Final');
    expect(resolveKey(dictionaries.es, 'no.existe')).toBe('no.existe');
  });

  it('interpola variables {n} en todas sus apariciones y deja las desconocidas', () => {
    expect(interpolate('{n} en directo', { n: 3 })).toBe('3 en directo');
    expect(interpolate('{a}-{a} {b}', { a: 1 })).toBe('1-1 {b}');
    expect(interpolate('sin variables')).toBe('sin variables');
  });
});
