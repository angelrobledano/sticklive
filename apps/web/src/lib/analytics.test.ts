import { describe, it, expect } from 'vitest';
import {
  normalizeRoute,
  searchEventProps,
  matchAnalyticsDecision,
  segmentationProps,
} from './analytics';

describe('normalizeRoute: slugs y catalán (revisión del plan 03/11/2026)', () => {
  it('la ficha de competición por slug se agrega con la de UUID', () => {
    expect(normalizeRoute('/es/competitions/ok-liga-masculina')).toEqual({ route: '/competitions/:id', locale: 'es' });
  });
  it('los hubs siguen con su ruta legible', () => {
    expect(normalizeRoute('/es/competitions/federation/fap').route).toBe('/competitions/federation/fap');
  });
  it('clubes', () => {
    expect(normalizeRoute('/es/clubs/barca').route).toBe('/clubs/:id');
  });
  it('catalán como idioma', () => {
    expect(normalizeRoute('/ca/matches/0073f9aa-1111-4222-8333-444455556666')).toEqual({ route: '/matches/:id', locale: 'ca' });
  });
});

describe('normalizeRoute', () => {
  it('normaliza los UUID a :id y extrae el locale', () => {
    expect(normalizeRoute('/es/matches/0073f9aa-1111-4222-8333-444455556666')).toEqual({
      route: '/matches/:id',
      locale: 'es',
    });
    expect(normalizeRoute('/pt/players/0073f9aa-1111-4222-8333-444455556666')).toEqual({
      route: '/players/:id',
      locale: 'pt',
    });
  });

  it('sin locale deja locale null y conserva la ruta', () => {
    expect(normalizeRoute('/competitions')).toEqual({ route: '/competitions', locale: null });
    expect(normalizeRoute('/')).toEqual({ route: '/', locale: null });
  });
});

describe('searchEventProps (#240)', () => {
  it('resume la query sin exponer el texto en claro', () => {
    const props = searchEventProps('  Copa   del Rey ', 7);
    expect(props).toEqual({
      query_length: 'Copa del Rey'.length,
      query_terms: 3,
      result_count: 7,
      has_results: true,
    });
    expect(props).not.toHaveProperty('query');
  });

  it('marca cero resultados y query vacía', () => {
    expect(searchEventProps('xyz', 0)).toEqual({
      query_length: 3,
      query_terms: 1,
      result_count: 0,
      has_results: false,
    });
    expect(searchEventProps('   ', 0)).toEqual({
      query_length: 0,
      query_terms: 0,
      result_count: 0,
      has_results: false,
    });
  });
});

describe('matchAnalyticsDecision (#241)', () => {
  it('al montar un partido ya en vivo emite vista y seguimiento', () => {
    expect(matchAnalyticsDecision(null, 'live')).toEqual({ emitView: true, emitLiveFollowed: true });
  });

  it('al montar en scheduled emite la vista pero no el seguimiento', () => {
    expect(matchAnalyticsDecision(null, 'scheduled')).toEqual({ emitView: true, emitLiveFollowed: false });
  });

  it('emite el seguimiento en la transición scheduled → live', () => {
    expect(matchAnalyticsDecision('scheduled', 'live')).toEqual({ emitView: true, emitLiveFollowed: true });
  });

  it('no repite la vista si el estado no cambia (poll)', () => {
    expect(matchAnalyticsDecision('live', 'live')).toEqual({ emitView: false, emitLiveFollowed: false });
  });

  it('deja de seguir al terminar y no re-emite seguimiento', () => {
    expect(matchAnalyticsDecision('live', 'finished')).toEqual({ emitView: true, emitLiveFollowed: false });
  });
});

describe('segmentationProps (#245)', () => {
  it('sin navegador (SSR/test) devuelve objeto vacío', () => {
    expect(segmentationProps()).toEqual({});
  });
});
