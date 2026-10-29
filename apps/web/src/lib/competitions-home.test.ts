import { describe, it, expect } from 'vitest';
import type { CompetitionSummary } from '@/lib/api/client';
import { buildCompetitionsHome, cupIsActive, groupVariants } from './competitions-home';

const NOW = new Date('2026-10-29T12:00:00Z');
const day = (d: number) => new Date(NOW.getTime() + d * 86_400_000).toISOString();

function comp(slug: string, over: Partial<Omit<CompetitionSummary, 'season'>> & { season?: Partial<NonNullable<CompetitionSummary['season']>> } = {}): CompetitionSummary {
  const { season, ...rest } = over;
  return {
    id: slug, slug, name: slug.toUpperCase(), nameI18n: null, shortName: null, logoUrl: null,
    gender: 'male', category: 'senior', country: 'ES', organizer: 'RFEP', scope: 'national', region: null,
    ageCategory: 'senior', dataQuality: 'ok', tier: null, featuredRank: null, federation: null,
    season: { id: `s-${slug}`, name: '2026/27', startDate: null, endDate: null, isCurrent: true, teamCount: 14, matchCount: 10,
      firstMatchAt: day(-30), lastMatchAt: day(150), nextMatchAt: day(2), liveMatches: 0, ...season },
    ...rest,
  } as CompetitionSummary;
}

describe('buildCompetitionsHome', () => {
  const all = [
    comp('ok-liga-masculina'), comp('ok-liga-femenina', { gender: 'female' }),
    comp('campeonato-placard-portugal', { country: 'PT', organizer: 'FPP' }),
    comp('campionato-serie-a1', { country: 'IT', organizer: 'FISR' }),
    comp('ok-liga-plata-norte'), comp('ok-liga-plata-sur'), comp('nacional-catalana-masculina', { scope: 'regional' }),
    comp('2-divisao-portugal', { country: 'PT' }), comp('campionato-serie-a2', { country: 'IT' }),
    comp('copa-del-rey', { season: { firstMatchAt: day(120), lastMatchAt: day(123), nextMatchAt: day(120) } }),
    comp('supercopa-de-espana-masculina', { season: { firstMatchAt: day(-5), lastMatchAt: day(-4), nextMatchAt: null } }),
    comp('taca-de-portugal', { country: 'PT', season: { firstMatchAt: day(-20), lastMatchAt: day(200), nextMatchAt: day(10) } }),
    comp('mundial-masculino-worldskate', { scope: 'international', country: 'W', season: { firstMatchAt: day(-60), lastMatchAt: day(-45), nextMatchAt: null } }),
    comp('primera-catalana-masculina', { scope: 'regional' }),
  ];

  it('Big 4 en el orden del producto: OK Liga, Placard, Iberdrola, Serie A1', () => {
    expect(buildCompetitionsHome(all, NOW).big.map((c) => c.slug)).toEqual([
      'ok-liga-masculina', 'campeonato-placard-portugal', 'ok-liga-femenina', 'campionato-serie-a1',
    ]);
  });

  it('la WSE Champions entra en los principales cuando existe', () => {
    const wse = comp('wse-champions-league', { name: 'WSE Champions League', organizer: 'WSE', scope: 'international', country: 'W' });
    expect(buildCompetitionsHome([...all, wse], NOW).big.map((c) => c.slug)).toContain('wse-champions-league');
  });

  it('segundo nivel por país, sin las autonómicas que no son "nacionales de facto"', () => {
    const { second } = buildCompetitionsHome(all, NOW);
    expect(second.ES.map((c) => c.slug)).toEqual(['ok-liga-plata-norte', 'ok-liga-plata-sur', 'nacional-catalana-masculina']);
    expect(second.PT.map((c) => c.slug)).toEqual(['2-divisao-portugal']);
    expect(second.IT.map((c) => c.slug)).toEqual(['campionato-serie-a2']);
  });

  it('copas solo cerca de sus fechas: Taça (ronda en 10 días) sí, Copa del Rey (en 4 meses) no, Supercopa recién jugada sí, Mundial terminado no', () => {
    expect(buildCompetitionsHome(all, NOW).cups.map((c) => c.slug)).toEqual(['supercopa-de-espana-masculina', 'taca-de-portugal']);
  });
});

describe('cupIsActive', () => {
  it('en juego ahora: siempre', () => {
    expect(cupIsActive(comp('x', { season: { liveMatches: 1, nextMatchAt: null, lastMatchAt: day(-100) } }), NOW)).toBe(true);
  });
  it('próximo partido dentro de 14 días', () => {
    expect(cupIsActive(comp('x', { season: { nextMatchAt: day(14) } }), NOW)).toBe(true);
    expect(cupIsActive(comp('x', { season: { nextMatchAt: day(15), firstMatchAt: day(15), lastMatchAt: day(16) } }), NOW)).toBe(false);
  });
  it('payload antiguo sin calendario: no se destaca', () => {
    expect(cupIsActive(comp('x', { season: { nextMatchAt: undefined, lastMatchAt: undefined, firstMatchAt: undefined, liveMatches: undefined } }), NOW)).toBe(false);
  });
});

describe('groupVariants', () => {
  it('Plata Norte y Sur en una sola fila con sus variantes', () => {
    const g = groupVariants([comp('ok-liga-plata-norte', { name: 'OK LIGA PLATA NORTE' }), comp('ok-liga-plata-sur', { name: 'OK LIGA PLATA SUR' }), comp('ok-liga-plata-femenina', { name: 'OK LIGA PLATA FEMENINA' })]);
    expect(g.map((r) => [r.label, r.variants.map((v) => v.label)])).toEqual([
      ['OK LIGA PLATA', ['Norte', 'Sur']], ['OK LIGA PLATA FEMENINA', []],
    ]);
  });
});
