import { describe, it, expect } from 'vitest';
import { teamTabFromParam } from './TeamCenterClient';

/**
 * #352: el tab activo de la ficha de equipo viaja en la URL (?tab=) para poder
 * compartir el enlace y recuperarlo al volver.
 */
const VISIBLE = ['Resumen', 'Calendario', 'Plantilla', 'Estadísticas'] as const;

describe('teamTabFromParam (#352)', () => {
  it('mapea los slugs canónicos de la URL a su tab', () => {
    expect(teamTabFromParam('summary', VISIBLE)).toBe('Resumen');
    expect(teamTabFromParam('calendar', VISIBLE)).toBe('Calendario');
    expect(teamTabFromParam('squad', VISIBLE)).toBe('Plantilla');
    expect(teamTabFromParam('stats', VISIBLE)).toBe('Estadísticas');
  });

  it('sin parámetro no impone tab (se usa el defecto)', () => {
    expect(teamTabFromParam(null, VISIBLE)).toBeNull();
    expect(teamTabFromParam('', VISIBLE)).toBeNull();
  });

  it('ignora un valor desconocido o de otra mayúscula/acento', () => {
    expect(teamTabFromParam('basura', VISIBLE)).toBeNull();
    expect(teamTabFromParam('Squad', VISIBLE)).toBeNull();
    expect(teamTabFromParam('plantilla', VISIBLE)).toBeNull();
  });
});
