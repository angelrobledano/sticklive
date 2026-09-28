import { describe, it, expect } from 'vitest';
import { entityViewFromPath, entityIdProp } from './analytics-entity';

describe('entityViewFromPath', () => {
  it('detecta la vista de competición con su id (no normalizado)', () => {
    expect(entityViewFromPath('/es/competitions/d17148e5-1111-4222-8333-444455556666')).toEqual({
      event: 'competition_view',
      id: 'd17148e5-1111-4222-8333-444455556666',
    });
  });

  it('detecta la vista de equipo con su id', () => {
    expect(entityViewFromPath('/pt/teams/0073f9aa-1111-4222-8333-444455556666')).toEqual({
      event: 'team_view',
      id: '0073f9aa-1111-4222-8333-444455556666',
    });
  });

  // #242: la ficha de jugador es la superficie más numerosa del catálogo.
  it('detecta la vista de jugador con su id', () => {
    expect(entityViewFromPath('/es/players/1a2b3c4d-1111-4222-8333-444455556666')).toEqual({
      event: 'player_view',
      id: '1a2b3c4d-1111-4222-8333-444455556666',
    });
    expect(entityViewFromPath('/en/players/1a2b3c4d-1111-4222-8333-444455556666')).toEqual({
      event: 'player_view',
      id: '1a2b3c4d-1111-4222-8333-444455556666',
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
