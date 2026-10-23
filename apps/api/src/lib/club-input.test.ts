import { describe, it, expect } from 'vitest';
import { parseClubPatch, slugifyClubName } from './club-input.js';

describe('parseClubPatch', () => {
  it('limpia y acepta nombre, slug y ciudad', () => {
    expect(parseClubPatch({ canonicalName: '  HC   Palau ', slug: 'HC-Palau', city: ' Palau-solità ' }))
      .toEqual({ ok: true, patch: { canonicalName: 'HC Palau', slug: 'hc-palau', city: 'Palau-solità' } });
  });

  it('ciudad vacía o null la borra', () => {
    expect(parseClubPatch({ city: '' })).toEqual({ ok: true, patch: { city: null } });
    expect(parseClubPatch({ city: null })).toEqual({ ok: true, patch: { city: null } });
  });

  it('rechaza entradas inválidas', () => {
    for (const body of [
      null, {}, { canonicalName: '' }, { canonicalName: 3 }, { canonicalName: 'a'.repeat(121) },
      { slug: 'hc palau' }, { slug: 'hc--palau' }, { slug: 'ac2ef132-1234-4abc-8def-0123456789ab' },
      { city: 5 }, { canonicalName: 'HC\u0007Palau' },
    ]) {
      expect(parseClubPatch(body).ok).toBe(false);
    }
  });
});

describe('slugifyClubName', () => {
  it('quita acentos y símbolos', () => {
    expect(slugifyClubName('CP Voltregà')).toBe('cp-voltrega');
    expect(slugifyClubName("Unió Esportiva d'Horta")).toBe('unio-esportiva-d-horta');
    expect(slugifyClubName('  Reus Deportiu  ')).toBe('reus-deportiu');
  });
});
