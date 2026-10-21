import { describe, expect, it } from 'vitest';
import { initials, playerPhotoUri, teamLogoUri } from './Avatar';

describe('Avatar utilities', () => {
  describe('teamLogoUri and playerPhotoUri', () => {
    it('construye la URI del proxy del API con width por defecto', () => {
      expect(teamLogoUri('team-1')).toContain('/teams/team-1/logo?w=64');
      expect(playerPhotoUri('player-1')).toContain('/players/player-1/photo?w=64');
    });

    it('respeta ancho personalizado', () => {
      expect(teamLogoUri('team-1', 192)).toContain('/teams/team-1/logo?w=192');
      expect(playerPhotoUri('player-1', 128)).toContain('/players/player-1/photo?w=128');
    });
  });

  describe('initials', () => {
    it('extrae hasta 2 iniciales de nombres compuestos', () => {
      expect(initials('FC Barcelona')).toBe('FB');
      expect(initials('Liceo')).toBe('L');
      expect(initials('Club Patí Voltregà')).toBe('CP');
    });

    it('tolera undefined, null y strings vacíos sin lanzar TypeError', () => {
      expect(initials(undefined)).toBe('?');
      expect(initials(null)).toBe('?');
      expect(initials('')).toBe('?');
      expect(initials('   ')).toBe('?');
    });

    it('tolera tipos no string defensivamente', () => {
      // @ts-expect-error test defensivo en runtime
      expect(initials(123)).toBe('?');
    });
  });
});
