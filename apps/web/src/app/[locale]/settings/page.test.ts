import { describe, it, expect } from 'vitest';
import { myTeamsState } from './state';

/**
 * #344: en Ajustes, "Mis equipos" debe distinguir un fallo de API de un usuario
 * que de verdad no sigue a nadie. Antes, un error dejaba la lista vacía y se
 * mostraba el copy de onboarding a quien sí tenía equipos.
 */
describe('myTeamsState (#344)', () => {
  it('un error de API gana al estado vacío (no muestra onboarding)', () => {
    expect(myTeamsState({ loading: false, hasError: true, count: 0 })).toBe('error');
  });

  it('mientras carga, se muestra carga (no error)', () => {
    expect(myTeamsState({ loading: true, hasError: true, count: 0 })).toBe('loading');
  });

  it('sin error y con equipos muestra la lista', () => {
    expect(myTeamsState({ loading: false, hasError: false, count: 3 })).toBe('list');
  });

  it('sin error y sin equipos muestra el estado vacío', () => {
    expect(myTeamsState({ loading: false, hasError: false, count: 0 })).toBe('empty');
  });
});
