import { describe, it, expect } from 'vitest';
import { normalizeCompetitionFormat } from './competition-format.js';

/**
 * Formato de competición declarado en competition_sources.external_ids.format
 * (#166): los valores reconocidos pasan tal cual; cualquier otro (NULL, vacío,
 * valor futuro) cae a 'league'. Es el mismo criterio que aplicaba inline
 * season-overview; ahora es compartido con team-detail.
 */
describe('normalizeCompetitionFormat', () => {
  it('pasan los valores reconocidos', () => {
    expect(normalizeCompetitionFormat('league')).toBe('league');
    expect(normalizeCompetitionFormat('bracket')).toBe('bracket');
    expect(normalizeCompetitionFormat('final_four')).toBe('final_four');
  });

  it('lo desconocido cae a liga', () => {
    expect(normalizeCompetitionFormat(null)).toBe('league');
    expect(normalizeCompetitionFormat('')).toBe('league');
    expect(normalizeCompetitionFormat('something_new')).toBe('league');
  });
});
