import { describe, it, expect } from 'vitest';
import { competitionEditorial } from './competition-editorial';

describe('competitionEditorial', () => {
  it('tiene contenido para las dos Supercopas', () => {
    for (const slug of ['supercopa-de-espana-masculina', 'supercopa-de-espana-femenina']) {
      const content = competitionEditorial(slug, 'es');
      expect(content).not.toBeNull();
      expect(content!.title).toContain('Supercopa');
      expect(content!.sections.some((s) => s.heading === 'Dónde se juega')).toBe(true);
      expect(content!.sections.flatMap((s) => s.body).join(' ')).toContain('Pavelló Municipal');
    }
  });

  it('no inventa contenido para competiciones sin editorial', () => {
    expect(competitionEditorial('ok-liga-masculina', 'es')).toBeNull();
    expect(competitionEditorial(null, 'es')).toBeNull();
  });

  it('cae al español en locales sin traducción', () => {
    const fallback = competitionEditorial('supercopa-de-espana-masculina', 'fr');
    const es = competitionEditorial('supercopa-de-espana-masculina', 'es');
    expect(fallback).toEqual(es);
  });
});
