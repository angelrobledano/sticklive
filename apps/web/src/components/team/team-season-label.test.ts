import { describe, it, expect } from 'vitest';
import { seasonOptionLabel } from './TeamCenterClient';
import type { TeamSeason } from '@/lib/api/client';

/**
 * Selector de temporada de la ficha de equipo: cada opción muestra
 * "Competición · temporada" y marca la vigente.
 */
const t = (k: string) => (k === 'common.current' ? 'Actual' : k);

const BASE: TeamSeason = {
  id: 's1',
  name: '2026/27',
  isCurrent: true,
  competitionName: 'OK Liga Masculina',
  competitionShort: 'OKL',
};

describe('seasonOptionLabel', () => {
  it('usa el nombre corto de la competición y marca la actual', () => {
    expect(seasonOptionLabel(BASE, t)).toBe('OKL · 2026/27 · Actual');
  });

  it('cae al nombre completo y no marca las históricas', () => {
    expect(seasonOptionLabel({ ...BASE, competitionShort: null, isCurrent: false }, t))
      .toBe('OK Liga Masculina · 2026/27');
  });
});
