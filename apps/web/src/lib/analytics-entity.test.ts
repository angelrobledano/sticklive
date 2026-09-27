import { describe, it, expect } from 'vitest';
import { entityViewFromPath } from './analytics-entity';

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

  it('ignora rutas sin entidad, ids no-UUID y subrutas de partido', () => {
    expect(entityViewFromPath('/es/competitions')).toBeNull();
    expect(entityViewFromPath('/es/matches/0073f9aa-1111-4222-8333-444455556666')).toBeNull();
    expect(entityViewFromPath('/es/teams/no-soy-un-uuid')).toBeNull();
    expect(entityViewFromPath('/')).toBeNull();
  });
});
