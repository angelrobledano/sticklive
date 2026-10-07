import { describe, expect, it } from 'vitest';

import { hasNavigatedBeyondInitial, isNonDefaultInitialSurface } from './navigation-state.js';

// Shapes REALES de react-navigation v7 (reducidos a lo que la función lee):
// { index, routes: [{ key, name, state? }] }. Los tabs pre-pueblan su estado
// con TODAS las rutas (TabRouter.getInitialState, expo-router v7): ese es el
// bug que motiva comparar contra el estado INICIAL y no de forma absoluta.
interface NavRouteFixture {
  key: string;
  name: string;
  state?: NavStateFixture;
}

interface NavStateFixture {
  index: number;
  routes: NavRouteFixture[];
}

const TABS_STATE: NavStateFixture = {
  index: 0,
  routes: [
    { key: 'index-key', name: 'index' },
    { key: 'standings-key', name: 'standings' },
    { key: 'search-key', name: 'search' },
    { key: 'favorites-key', name: 'favorites' },
    { key: 'settings-key', name: 'settings' },
  ],
};

const INITIAL: NavStateFixture = {
  index: 0,
  routes: [
    {
      key: 'root-key',
      name: '(root)',
      state: {
        index: 0,
        routes: [{ key: 'tabs-key', name: '(tabs)', state: TABS_STATE }],
      },
    },
  ],
};

type AppState = typeof INITIAL;

const appStackOf = (s: AppState) => s.routes[0]!.state!;
const tabsOf = (s: AppState) => appStackOf(s).routes[0]!.state!;

describe('hasNavigatedBeyondInitial (navegación real vs superficie inicial)', () => {
  it('estado inicial de tabs (5 routes pre-pobladas, index 0) + initial idéntico ⇒ false', () => {
    expect(hasNavigatedBeyondInitial(structuredClone(INITIAL), INITIAL)).toBe(false);
  });

  it('mismo estado de tabs con index 1 (cambio de pestaña) ⇒ true', () => {
    const current = structuredClone(INITIAL);
    tabsOf(current).index = 1;
    expect(hasNavigatedBeyondInitial(current, INITIAL)).toBe(true);
  });

  it('stack con depth > inicial (push a ficha) ⇒ true', () => {
    const current = structuredClone(INITIAL);
    const appStack = appStackOf(current);
    appStack.routes.push({ key: 'match-key', name: 'match/[id]' });
    appStack.index = 1;
    expect(hasNavigatedBeyondInitial(current, INITIAL)).toBe(true);
  });

  it('ruta activa distinta con mismos length/index ⇒ true', () => {
    const current = structuredClone(INITIAL);
    appStackOf(current).routes[0]!.name = 'otra-ruta';
    expect(hasNavigatedBeyondInitial(current, INITIAL)).toBe(true);
  });

  it('unknown shapes ⇒ true (fail-closed: ante la duda no se muestra el ad)', () => {
    expect(hasNavigatedBeyondInitial('garbage', INITIAL)).toBe(true);
    expect(hasNavigatedBeyondInitial(INITIAL, null)).toBe(true);
    expect(hasNavigatedBeyondInitial({ routes: 'no-soy-array' }, INITIAL)).toBe(true);
    expect(hasNavigatedBeyondInitial({ index: 0 }, INITIAL)).toBe(true); // sin routes
    expect(hasNavigatedBeyondInitial(INITIAL, { index: 'x', routes: [] })).toBe(true); // initial sin index válido
  });

  it('ambos lados sin estado anidado ⇒ false (fondo idéntico, no es navegación)', () => {
    expect(hasNavigatedBeyondInitial(undefined, undefined)).toBe(false);
  });
});

describe('isNonDefaultInitialSurface (hardening del app open: initial tardío / deep link)', () => {
  // Un initial capturado TARDE (o tras un deep link en frío) que NO sea la
  // superficie por defecto se trata como "ya navegó": la comparación relativa
  // diría "no navegó" y el app open pisaría contenido ya visible (review Task 4).
  it('superficie por defecto (tabs solas en el root, con sus 5 rutas pre-pobladas) ⇒ false', () => {
    expect(isNonDefaultInitialSurface(INITIAL, '(tabs)')).toBe(false);
  });

  it('deep link / initial tardío con una ficha apilada sobre los tabs ⇒ true', () => {
    const deepLink = structuredClone(INITIAL);
    const appStack = appStackOf(deepLink);
    appStack.routes.push({ key: 'match-key', name: 'match/[id]' });
    appStack.index = 1;
    expect(isNonDefaultInitialSurface(deepLink, '(tabs)')).toBe(true);
  });

  it('initial tardío tras cambiar de pestaña ⇒ true', () => {
    const switched = structuredClone(INITIAL);
    tabsOf(switched).index = 1;
    expect(isNonDefaultInitialSurface(switched, '(tabs)')).toBe(true);
  });

  it('activa que no es la default y sin estado anidable ⇒ true (conservador)', () => {
    expect(
      isNonDefaultInitialSurface({ index: 0, routes: [{ key: 'm', name: 'match/[id]' }] }, '(tabs)'),
    ).toBe(true);
  });

  it('shapes no reconocibles ⇒ true (ante la duda, no se muestra el app open)', () => {
    expect(isNonDefaultInitialSurface(null, '(tabs)')).toBe(true);
    expect(isNonDefaultInitialSurface('garbage', '(tabs)')).toBe(true);
    expect(isNonDefaultInitialSurface({ index: 0 }, '(tabs)')).toBe(true); // sin routes
    expect(isNonDefaultInitialSurface({ routes: [] }, '(tabs)')).toBe(true); // sin index válido
  });
});
