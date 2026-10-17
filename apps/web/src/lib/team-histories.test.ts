import { describe, it, expect } from 'vitest';
import { TEAM_HISTORIES, teamHistory } from './team-histories';

/**
 * Historia y palmarés de la OK Liga Masculina 2026/27.
 *
 * El valor está en que el contenido sea **verificable**: cada ficha debe traer
 * historia, al menos una fuente y fecha de revisión. Los textos no se generan
 * en runtime, así que este test es la guardia contra entradas a medias.
 */
describe('team-histories', () => {
  it('cubre los 14 equipos de la OK Liga Masculina 2026/27', () => {
    expect(Object.keys(TEAM_HISTORIES)).toHaveLength(14);
  });

  it('cada entrada tiene historia, fuentes y fecha de revisión', () => {
    for (const [teamId, entry] of Object.entries(TEAM_HISTORIES)) {
      expect(teamId, teamId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(entry.history.length, teamId).toBeGreaterThan(80);
      expect(entry.sources.length, teamId).toBeGreaterThan(0);
      expect(entry.updatedAt, teamId).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      for (const honour of entry.honours) expect(honour.length, teamId).toBeGreaterThan(3);
    }
  });

  it('teamHistory devuelve la entrada o null', () => {
    expect(teamHistory('ccc49524-8422-4e3e-883c-c0067cec913c')?.history).toContain('Liceo');
    expect(teamHistory('00000000-0000-0000-0000-000000000000')).toBeNull();
  });
});
