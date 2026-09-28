import { describe, it, expect } from 'vitest';
import { eventTeamName, eventAnnouncement } from './TimelineTab';

/**
 * #357: el timeline espejo comunica el equipo solo por posición visual
 * (local izq. / visitante der.). Para lectores de pantalla hacemos explícito el
 * equipo de cada evento, tanto en las filas como en el anuncio `aria-live`.
 */

const t = (k: string) => k;

describe('eventTeamName (#357)', () => {
  it('devuelve el equipo local cuando el evento es del local', () => {
    expect(eventTeamName({ isHomeTeam: true }, 'LOC', 'VIS')).toBe('LOC');
  });

  it('devuelve el equipo visitante cuando el evento es del visitante', () => {
    expect(eventTeamName({ isHomeTeam: false }, 'LOC', 'VIS')).toBe('VIS');
  });
});

describe('eventAnnouncement incluye el equipo (#357)', () => {
  const goal = {
    id: 'e1',
    eventType: 'goal' as const,
    minute: 12,
    period: 1,
    clock: '10:00',
    teamId: 'home',
    isHomeTeam: true,
    detail: null,
    player: { id: 'p1', firstName: 'Pau', lastName: 'Pérez' },
  };

  it('nombra al jugador Y al equipo (no solo por posición)', () => {
    const s = eventAnnouncement(goal, t, 'LOC', 'VIS');
    expect(s).toContain('Pau Pérez');
    expect(s).toContain('LOC');
  });

  it('en eventos sin jugador, el equipo es la referencia', () => {
    const timeout = {
      id: 'e2',
      eventType: 'timeout' as const,
      minute: 20,
      period: 2,
      clock: '05:00',
      teamId: 'away',
      isHomeTeam: false,
      detail: null,
      player: null,
    };
    const s = eventAnnouncement(timeout, t, 'LOC', 'VIS');
    expect(s).toContain('VIS');
  });
});
