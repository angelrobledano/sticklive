import { describe, expect, it } from 'vitest';
import { LOCALES, dictionaries, resolveKey } from './locales';

describe('locales', () => {
  it('carga los 5 idiomas de la web', () => {
    expect(LOCALES).toEqual(['en', 'es', 'fr', 'it', 'pt']);
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
    expect(resolveKey(dictionaries.es, 'no.existe')).toBe('no.existe');
  });
});
