import { describe, it, expect } from 'vitest';
import { favoriteToggleEvent } from './analytics';

/**
 * #243: un click en la estrella emitía DOS eventos (`favorite_added` desde el
 * hook + `follow_created` desde FavoriteStar). Se unifica en un único evento
 * canónico `favorite_added` (no se renombra la serie histórica) con el preset
 * elegido como propiedad `preset_selected`. Esta función pura fija esa decisión.
 */

describe('favoriteToggleEvent (#243)', () => {
  it('al AÑADIR devuelve un único favorite_added con el preset elegido', () => {
    const out = favoriteToggleEvent(true, 'team', 't1', 3, 'key_events');
    expect(out.event).toBe('favorite_added');
    expect(out.props).toEqual({
      kind: 'team',
      ref_id: 't1',
      total_favorites: 3,
      preset_selected: 'key_events',
    });
  });

  it('al añadir sin preset no incluye preset_selected', () => {
    const out = favoriteToggleEvent(true, 'league', 'l1', 1);
    expect(out.event).toBe('favorite_added');
    expect(out.props).toEqual({ kind: 'league', ref_id: 'l1', total_favorites: 1 });
    expect(out.props).not.toHaveProperty('preset_selected');
  });

  it('al QUITAR emite favorite_removed y nunca preset_selected', () => {
    const out = favoriteToggleEvent(false, 'player', 'p1', 0, 'key_events');
    expect(out.event).toBe('favorite_removed');
    expect(out.props).toEqual({ kind: 'player', ref_id: 'p1', total_favorites: 0 });
    expect(out.props).not.toHaveProperty('preset_selected');
  });

  it('no existe un segundo nombre de evento para la misma intención', () => {
    // Regresión #243: el evento canónico nunca es `follow_created`.
    expect(favoriteToggleEvent(true, 'team', 't1', 1, 'key_events').event).not.toBe('follow_created');
    expect(favoriteToggleEvent(true, 'team', 't1', 1).event).not.toBe('follow_created');
  });
});
