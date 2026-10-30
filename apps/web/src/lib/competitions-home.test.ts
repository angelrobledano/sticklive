import { describe, it, expect } from 'vitest';
import type { CompetitionSummary } from '@/lib/api/client';
import { buildCompetitionsHome, competitionStatus, cupIsActive, groupVariants } from './competitions-home';

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
  // Curación como la de la migración 100 (featured_rank + tier en datos).
  const f = (featuredRank: number, tier: number | null = null) => ({ featuredRank, tier });
  const all = [
    comp('ok-liga-femenina', { gender: 'female', name: 'OK LIGA IBERDROLA', ...f(3, 1) }),
    comp('ok-liga-masculina', { name: 'OK LIGA MASCULINA', ...f(1, 1) }),
    comp('campeonato-placard-portugal', { country: 'PT', organizer: 'FPP', name: 'Campeonato Placard', ...f(2, 1) }),
    comp('campionato-serie-a1', { country: 'IT', organizer: 'FISR', name: 'CAMPIONATO SERIE A1', ...f(4, 1) }),
    comp('ok-liga-plata-norte', { name: 'OK LIGA PLATA NORTE', ...f(20, 2) }),
    comp('ok-liga-plata-sur', { name: 'OK LIGA PLATA SUR', ...f(21, 2) }),
    comp('nacional-catalana-masculina', { scope: 'regional', name: 'NACIONAL CATALANA MASCULINA', ...f(27, 3) }),
    comp('2-divisao-portugal', { country: 'PT', name: 'Campeonato Nacional 2ª Divisão', ...f(30, 2) }),
    comp('campionato-serie-a2', { country: 'IT', name: 'CAMPIONATO SERIE A2', ...f(31, 2) }),
    comp('copa-del-rey', { name: 'COPA DEL REY', ...f(40), season: { firstMatchAt: day(120), lastMatchAt: day(123), nextMatchAt: day(120) } }),
    comp('supercopa-de-espana-masculina', { name: 'SUPERCOPA DE ESPAÑA MASCULINA', ...f(42), season: { firstMatchAt: day(-5), lastMatchAt: day(-4), nextMatchAt: null } }),
    comp('taca-de-portugal', { country: 'PT', name: 'Taça de Portugal', ...f(46), season: { firstMatchAt: day(-20), lastMatchAt: day(200), nextMatchAt: day(10) } }),
    comp('mundial-masculino-worldskate', { scope: 'international', country: 'W', name: 'Mundial Masculino', ...f(10), season: { firstMatchAt: day(-60), lastMatchAt: day(-45), nextMatchAt: null } }),
    comp('primera-catalana-masculina', { scope: 'regional', name: 'PRIMERA CATALANA MASCULINA' }),
  ];

  it('principales: destacadas de primer nivel que no son copa, por featured_rank', () => {
    expect(buildCompetitionsHome(all, NOW).big.map((c) => c.slug)).toEqual([
      'ok-liga-masculina', 'campeonato-placard-portugal', 'ok-liga-femenina', 'campionato-serie-a1',
    ]);
  });

  it('la WSE Champions entra en los principales cuando existe', () => {
    const wse = comp('wse-champions-league', { name: 'WSE Champions League', organizer: 'WSE', scope: 'international', country: 'W', ...f(5, 1) });
    expect(buildCompetitionsHome([...all, wse], NOW).big.map((c) => c.slug)).toContain('wse-champions-league');
  });

  it('segundo nivel: el resto de destacadas, por país; lo no destacado no sale', () => {
    const { second } = buildCompetitionsHome(all, NOW);
    expect(second.ES.map((c) => c.slug)).toEqual(['ok-liga-plata-norte', 'ok-liga-plata-sur', 'nacional-catalana-masculina']);
    expect(second.PT.map((c) => c.slug)).toEqual(['2-divisao-portugal']);
    expect(second.IT.map((c) => c.slug)).toEqual(['campionato-serie-a2']);
  });

  it('nada de esto depende de slugs: una destacada nueva entra sola', () => {
    const nueva = comp('liga-nueva-francia', { country: 'FR', name: 'Nationale 1', ...f(33, 2) });
    expect(buildCompetitionsHome([...all, nueva], NOW).second.FR?.map((c) => c.slug)).toEqual(['liga-nueva-francia']);
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

describe('competitionStatus', () => {
  it('en juego manda, con la jornada si es liga', () => {
    expect(competitionStatus(comp('x', { season: { liveMatches: 2, matchday: { current: 7, total: 26 } } }))).toEqual({ kind: 'live', live: 2, matchday: 7 });
  });
  it('copa terminada: el campeón', () => {
    const champion = { teamId: 't', name: 'FC Barcelona', shortName: 'Barça', logoUrl: null };
    expect(competitionStatus(comp('x', { season: { champion, nextMatchAt: null } }))).toEqual({ kind: 'champion', team: champion });
  });
  it('liga: jornada en curso sobre el total', () => {
    expect(competitionStatus(comp('x', { season: { matchday: { current: 7, total: 26 } } }))).toEqual({ kind: 'matchday', current: 7, total: 26 });
  });
  it('copa en curso: próximo partido', () => {
    expect(competitionStatus(comp('x', { season: { nextMatchAt: day(2) } }))).toEqual({ kind: 'next', at: day(2) });
  });
});
