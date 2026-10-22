import { describe, it, expect } from 'vitest';
import { classifyCompetition, planCoverage } from './federation-coverage.js';

/**
 * B3 — plan de cobertura de un portal autonómico (FECAPA: 110 competiciones
 * vigentes frente a 1 en Stick Live). Nombres y grupos reales del catálogo.
 */
describe('classifyCompetition', () => {
  it.each([
    ['NACIONAL CATALANA MASCULINA', 'Nacional Catalana', { gender: 'male', ageCategory: 'senior', review: false }],
    ['PRIMERA CATALANA FEMENINA', 'Primera Catalana', { gender: 'female', ageCategory: 'senior', review: false }],
    ['JÚNIOR OR', 'Júnior', { gender: 'male', ageCategory: 'junior', review: false }],
    ['JUVENIL PLATA', 'Juvenil', { gender: 'male', ageCategory: 'juvenil', review: false }],
    ['ALEVÍ BRONZE', 'Aleví', { gender: 'male', ageCategory: 'alevin', review: false }],
    ['PREBENJAMI OR BARCELONA', 'Prebenjamí', { gender: 'male', ageCategory: 'prebenjamin', review: false }],
    ['BENJAMÍ PLATA BARCELONA', 'Benjamí', { gender: 'male', ageCategory: 'benjamin', review: false }],
    ['FEM 17 OR', 'Femení 17', { gender: 'female', ageCategory: 'juvenil', review: true }],
    ['LLIGA CATALANA DE VETERANS', 'Copes i tornejos', { gender: 'male', ageCategory: 'veteranos', review: false }],
    ['MINIFEM', 'Mini', { gender: 'female', ageCategory: 'base', review: true }],
  ])('%s', (name, group, expected) => {
    expect(classifyCompetition(name, group)).toMatchObject(expected);
  });

  it('lo que no sabe clasificar va a revisión, no se inventa', () => {
    expect(classifyCompetition('YOUTH GOLDEN CAT', 'Altres')).toMatchObject({ review: true });
  });
});

describe('planCoverage', () => {
  it('separa lo ya dado de alta de lo pendiente, y genera el comando de alta con el portal', () => {
    const plan = planCoverage('fecapa', [
      { idc: '4858', name: 'FRIT RAVICH LLIGA CATALANA', group: 'Copes i tornejos', tempId: '41' },
      { idc: '5001', name: 'NACIONAL CATALANA MASCULINA', group: 'Nacional Catalana', tempId: '41' },
    ], new Set(['fecapa_competition_4858']));
    expect(plan.existing.map((c) => c.idc)).toEqual(['4858']);
    expect(plan.pending).toHaveLength(1);
    expect(plan.pending[0]!.command).toContain('SIDGAD_PORTAL=fecapa');
    expect(plan.pending[0]!.command).toContain('--idc=5001');
    expect(plan.pending[0]!.command).toContain('--gender=male');
    expect(plan.pending[0]!.command).toContain('--season=2026/27');
  });
});
