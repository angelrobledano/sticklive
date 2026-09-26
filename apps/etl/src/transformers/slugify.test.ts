import { describe, it, expect } from 'vitest';
import { slugify, uniqueSlug } from './slugify.js';

describe('slugify', () => {
  it('minúsculas, diacríticos y ñ', () => {
    expect(slugify('Águila')).toBe('aguila');
    expect(slugify('Voltregà')).toBe('voltrega');
    expect(slugify('Peña Ñu')).toBe('pena-nu');
  });
  it('colapsa puntuación/espacios en guiones y recorta extremos', () => {
    expect(slugify('C.P. Voltregà!')).toBe('c-p-voltrega');
    expect(slugify('  Hola   Mundo  ')).toBe('hola-mundo');
  });
  it('limita a 100 caracteres', () => {
    expect(slugify('a'.repeat(250)).length).toBe(100);
  });
});

describe('uniqueSlug', () => {
  it('devuelve el slug base si no colisiona', () => {
    expect(uniqueSlug('Liceo', new Set())).toBe('liceo');
  });
  it('añade sufijo incremental ante colisión', () => {
    expect(uniqueSlug('Liceo', new Set(['liceo']))).toBe('liceo-2');
    expect(uniqueSlug('Liceo', new Set(['liceo', 'liceo-2']))).toBe('liceo-3');
  });
});
