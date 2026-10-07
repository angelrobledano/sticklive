import { describe, expect, it } from 'vitest';

import { hasNavigatedBeyondInitial } from './navigation-state.js';

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
