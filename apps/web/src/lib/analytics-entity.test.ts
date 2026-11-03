import { describe, it, expect } from 'vitest';
import { entityViewFromPath, entityIdProp } from './analytics-entity';

describe('entityViewFromPath', () => {
  it('detecta la vista de competición con su id (no normalizado)', () => {
    expect(entityViewFromPath('/es/competitions/d17148e5-1111-4222-8333-444455556666')).toEqual({
      event: 'competition_view',
      id: 'd17148e5-1111-4222-8333-444455556666',
      slug: null,
    });
  });

  it('detecta la vista de equipo con su id', () => {
    expect(entityViewFromPath('/pt/teams/0073f9aa-1111-4222-8333-444455556666')).toEqual({
      event: 'team_view',
      id: '0073f9aa-1111-4222-8333-444455556666',
      slug: null,
    });
  });

  // #242: la ficha de jugador es la superficie más numerosa del catálogo.
  it('detecta la vista de jugador con su id', () => {
    expect(entityViewFromPath('/es/players/1a2b3c4d-1111-4222-8333-444455556666')).toEqual({
      event: 'player_view',
      id: '1a2b3c4d-1111-4222-8333-444455556666',
      slug: null,
    });
    expect(entityViewFromPath('/en/players/1a2b3c4d-1111-4222-8333-444455556666')).toEqual({
      event: 'player_view',
      id: '1a2b3c4d-1111-4222-8333-444455556666',
      slug: null,
    });
  });

  it('ignora rutas sin entidad, ids no-UUID y subrutas de partido', () => {
    expect(entityViewFromPath('/es/competitions')).toBeNull();
    expect(entityViewFromPath('/es/matches/0073f9aa-1111-4222-8333-444455556666')).toBeNull();
    expect(entityViewFromPath('/es/teams/no-soy-un-uuid')).toBeNull();
    expect(entityViewFromPath('/es/players/no-soy-un-uuid')).toBeNull();
    expect(entityViewFromPath('/')).toBeNull();
  });
});

describe('entityIdProp', () => {
  it('mapea cada evento de entidad a su propiedad de id', () => {
    expect(entityIdProp('competition_view')).toBe('competition_id');
    expect(entityIdProp('team_view')).toBe('team_id');
    expect(entityIdProp('player_view')).toBe('player_id');
  });
});

/**
 * Revisión del plan de tracking (03/11/2026): desde las URL legibles
 * (`/competitions/ok-liga-masculina`) no se emitía `competition_view` (los 252
 * eventos de 30 días = las 252 visitas por UUID). Tampoco había vista de club,
 * y el catalán no entraba en el prefijo de idioma.
 */
describe('entityViewFromPath con URL legibles, clubes y catalán', () => {
  it('competición por slug: evento con el slug', () => {
    expect(entityViewFromPath('/es/competitions/ok-liga-masculina')).toEqual({
      event: 'competition_view', id: null, slug: 'ok-liga-masculina',
    });
  });
  it('los hubs de federación y país no son una competición', () => {
    expect(entityViewFromPath('/es/competitions/federation/fecapa')).toBeNull();
    expect(entityViewFromPath('/es/competitions/country/ES')).toBeNull();
  });
  it('club por slug o por id', () => {
    expect(entityViewFromPath('/es/clubs/barca')).toEqual({ event: 'club_view', id: null, slug: 'barca' });
    expect(entityViewFromPath('/en/clubs/7c13c9ec-fb24-4951-9c90-b940698df1ce')).toEqual({
      event: 'club_view', id: '7c13c9ec-fb24-4951-9c90-b940698df1ce', slug: null,
    });
  });
  it('catalán', () => {
    expect(entityViewFromPath('/ca/teams/0073f9aa-1111-4222-8333-444455556666')?.event).toBe('team_view');
  });
});
