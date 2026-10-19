import { describe, it, expect } from 'vitest';
import { privacyDict } from './content';

describe('privacyDict', () => {
  it('sirve la política en francés, no la inglesa', () => {
    const fr = privacyDict('fr');
    expect(fr.title).toBe('Politique de confidentialité');
    expect(fr.sections[0]?.h).toBe('Qui sommes-nous');
    expect(fr.sections[fr.sections.length - 1]?.p).toContain('publicités non personnalisées');
  });

  it('mantiene ES y EN nativos', () => {
    expect(privacyDict('es').title).toBe('Política de privacidad');
    expect(privacyDict('en').title).toBe('Privacy policy');
  });

  it('sirve portugués e italiano nativos', () => {
    expect(privacyDict('pt').title).toBe('Política de privacidade');
    expect(privacyDict('pt').sections[0]?.h).toBe('Quem somos');
    expect(privacyDict('it').title).toBe('Informativa sulla privacy');
    expect(privacyDict('it').sections[0]?.h).toBe('Chi siamo');
  });

  it('un locale desconocido cae a EN', () => {
    expect(privacyDict('de').title).toBe('Privacy policy');
  });
});
