import { describe, it, expect } from 'vitest';
import { competitionEditorial, COMPETITION_EDITORIAL } from './competition-editorial';

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
    expect(competitionEditorial('ok-liga-plata-sur', 'es')).toBeNull();
    expect(competitionEditorial(null, 'es')).toBeNull();
  });

  it('tiene contenido para las dos OK Liga, con palmarés y campeón vigente', () => {
    const masc = competitionEditorial('ok-liga-masculina', 'es')!;
    const fem = competitionEditorial('ok-liga-femenina', 'es')!;
    expect(masc.title).toContain('OK Liga Masculina');
    expect(masc.sections.find((s) => s.heading === 'Palmarés')!.bullets![0]).toBe('2025/26: Igualada Rigat HC');
    expect(fem.sections.find((s) => s.heading === 'Palmarés')!.bullets![0]).toBe('2025/26: CP Vila-sana');
    expect(competitionEditorial('ok-liga-masculina', 'en')!.title).toContain('history');
  });

  it('tiene contenido para las ligas de Portugal e Italia', () => {
    for (const slug of ['campeonato-placard-portugal', 'campeonato-nacional-feminino-portugal', 'campionato-serie-a1']) {
      for (const locale of ['es', 'en']) {
        const c = competitionEditorial(slug, locale);
        expect(c).not.toBeNull();
        expect(c!.sections.length).toBeGreaterThanOrEqual(3);
        expect(c!.source?.url).toMatch(/^https:\/\//);
      }
    }
  });

  it('tiene versión en catalán de todos los textos', () => {
    for (const slug of Object.keys(COMPETITION_EDITORIAL)) {
      const ca = competitionEditorial(slug, 'ca');
      expect(ca, slug).not.toEqual(competitionEditorial(slug, 'es'));
      expect(ca!.sections.length, slug).toBe(competitionEditorial(slug, 'es')!.sections.length);
    }
    expect(competitionEditorial('ok-liga-masculina', 'ca')!.title).toContain('OK Lliga');
  });

  it('el slug del alta 2026/27 (ok-liga-iberdrola) usa el texto de la OK Liga femenina', () => {
    expect(competitionEditorial('ok-liga-iberdrola', 'es')).toEqual(competitionEditorial('ok-liga-femenina', 'es'));
  });

  it('cae al español en locales sin traducción', () => {
    const fallback = competitionEditorial('supercopa-de-espana-masculina', 'fr');
    const es = competitionEditorial('supercopa-de-espana-masculina', 'es');
    expect(fallback).toEqual(es);
  });
});
