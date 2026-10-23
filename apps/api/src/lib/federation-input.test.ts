import { describe, it, expect } from 'vitest';
import { parseFederationBody, parseRankingBody } from './federation-input.js';

describe('parseRankingBody', () => {
  it('acepta enteros, null para quitar y deja fuera lo no enviado', () => {
    expect(parseRankingBody({ tier: 2 })).toEqual({ ok: true, patch: { tier: 2 } });
    expect(parseRankingBody({ featuredRank: null })).toEqual({ ok: true, patch: { featuredRank: null } });
    expect(parseRankingBody({ tier: '', featuredRank: '12' })).toEqual({ ok: true, patch: { tier: null, featuredRank: 12 } });
  });

  it('rechaza fuera de rango, decimales y cuerpo vacío', () => {
    expect(parseRankingBody({ tier: 0 }).ok).toBe(false);
    expect(parseRankingBody({ tier: 1.5 }).ok).toBe(false);
    expect(parseRankingBody({ featuredRank: 'x' }).ok).toBe(false);
    expect(parseRankingBody({}).ok).toBe(false);
  });
});

describe('parseFederationBody', () => {
  const regional = { slug: 'fcp', name: 'Federación Canaria de Patinaje', level: 'regional', parentCode: 'RFEP', country: 'es', region: 'Canarias' };

  it('normaliza una autonómica válida', () => {
    const r = parseFederationBody('FCP', regional, 'national');
    expect(r).toEqual({ ok: true, input: {
      code: 'FCP', slug: 'fcp', name: 'Federación Canaria de Patinaje', shortName: 'FCP', level: 'regional',
      parentCode: 'RFEP', country: 'ES', region: 'Canarias', website: null, displayOrder: 100,
    } });
  });

  it('exige padre del nivel inmediatamente superior', () => {
    expect(parseFederationBody('FCP', regional, null).ok).toBe(false);
    expect(parseFederationBody('FCP', regional, 'continental').ok).toBe(false);
    expect(parseFederationBody('FCP', { ...regional, parentCode: 'FCP' }, 'national').ok).toBe(false);
  });

  it('valida slug, país, región y web', () => {
    expect(parseFederationBody('FCP', { ...regional, slug: 'Fcp Canarias' }, 'national').ok).toBe(false);
    expect(parseFederationBody('FCP', { ...regional, country: 'ESP' }, 'national').ok).toBe(false);
    expect(parseFederationBody('FCP', { ...regional, region: '' }, 'national').ok).toBe(false);
    expect(parseFederationBody('FCP', { ...regional, website: 'javascript:x' }, 'national').ok).toBe(false);
  });

  it('una nacional cuelga de una continental y no lleva región', () => {
    const r = parseFederationBody('FFRS', { slug: 'ffrs', name: 'Fédération Française', level: 'national', parentCode: 'WSE', country: 'FR', region: 'x' }, 'continental');
    expect(r.ok && r.input.region).toBe(null);
  });
});
