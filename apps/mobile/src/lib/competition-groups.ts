/**
 * Agrupación de la zona de competiciones para la app móvil.
 *
 * País y federación son el MISMO árbol (world → continental → national → regional):
 * la vista de un país es su federación nacional con las autonómicas colgando.
 * Todo sale de los datos (`federation`, `tier`, `featuredRank`, migración 089),
 * nada de listas de slugs ni de países hardcodeados en el front.
 */
import type { CompetitionSummary, Federation, FederationRef } from '@sports/core/api';
import { orderByImportance } from '@sports/core/competition-importance';

export type GenderFilter = 'all' | 'male' | 'female';

/** Copa / supercopa / torneo KO por nombre (no hay columna `kind`). */
export function isCup(c: Pick<CompetitionSummary, 'name'>): boolean {
  return /\b(super)?copa\b|ta[çc]a|supertaça|coppa|coupe|supercoppa/i.test(c.name);
}

/** Internacional: por scope o por colgar de World Skate / WSE. */
export function isInternational(c: CompetitionSummary): boolean {
  const lvl = c.federation?.level;
  return c.scope === 'international' || lvl === 'world' || lvl === 'continental';
}

/** País de la competición: el de su federación y, si no hay, el suyo propio. */
export function competitionCountry(c: CompetitionSummary): string | null {
  const code = c.federation?.country ?? c.country;
  return code ? code.toUpperCase() : null;
}

export function filterByGender(comps: CompetitionSummary[], g: GenderFilter): CompetitionSummary[] {
  if (g === 'all') return comps;
  // 'mixed' / null aparecen en ambos filtros: no son de un solo género.
  return comps.filter((c) => c.gender === g || c.gender === 'mixed' || c.gender == null);
}

/**
 * Destacadas: las curadas (`featuredRank`) en su orden. Si nadie ha curado
 * nada todavía, la máxima categoría sénior de cada país (tier 1) para que la
 * pestaña nunca salga vacía.
 */
export function featuredCompetitions(comps: CompetitionSummary[], locale: string): CompetitionSummary[] {
  const curated = comps.filter((c) => c.featuredRank != null);
  if (curated.length > 0) return orderByImportance(curated, locale);
  return orderByImportance(
    comps.filter((c) => c.tier === 1 && c.ageCategory === 'senior'),
    locale,
  );
}

export interface FederationGroup {
  /** Código de la federación, o `region:<texto>` si la competición no tiene federación. */
  key: string;
  federation: FederationRef | null;
  label: string;
  comps: CompetitionSummary[];
}

export interface CountrySections {
  /** Ligas principales (tier 1 sénior). */
  mainLeagues: CompetitionSummary[];
  /** Otras divisiones y categorías inferiores (tier > 1 sénior). */
  otherLeagues: CompetitionSummary[];
  /** Ligas sénior nacionales (no copas), por tier. */
  leagues: CompetitionSummary[];
  /** Copas y supercopas sénior nacionales. */
  cups: CompetitionSummary[];
  /** Categorías de base nacionales. */
  base: CompetitionSummary[];
  /** Federaciones autonómicas (o regiones sin federación), por display_order. */
  regional: FederationGroup[];
}

export interface CountryGroup {
  code: string;
  /** Federación nacional del país, si está dada de alta. */
  federation: FederationRef | null;
  total: number;
  sections: CountrySections;
}

export interface CompetitionTree {
  international: CompetitionSummary[];
  countries: CountryGroup[];
}

function fedOrder(federations: Federation[] | undefined): Map<string, number> {
  return new Map((federations ?? []).map((f) => [f.code, f.displayOrder]));
}

/** Secciones de un conjunto de competiciones de UN país. */
export function buildCountrySections(
  comps: CompetitionSummary[],
  locale: string,
  federations?: Federation[],
): CountrySections {
  const order = fedOrder(federations);
  const national = comps.filter((c) => c.scope !== 'regional' && c.federation?.level !== 'regional');
  const regionalComps = comps.filter((c) => !national.includes(c));

  const senior = national.filter((c) => c.ageCategory === 'senior');
  const leagues = orderByImportance(senior.filter((c) => !isCup(c)), locale);
  const mainLeagues = leagues.filter((c) => c.tier === 1);
  const otherLeagues = leagues.filter((c) => c.tier !== 1);
  const finalMain = mainLeagues.length > 0 ? mainLeagues : leagues.slice(0, 2);
  const finalOther = mainLeagues.length > 0 ? otherLeagues : leagues.slice(2);
  const cups = orderByImportance(senior.filter(isCup), locale);
  const base = orderByImportance(national.filter((c) => c.ageCategory !== 'senior'), locale);

  const groups = new Map<string, FederationGroup>();
  for (const c of regionalComps) {
    const key = c.federation?.code ?? `region:${c.region ?? ''}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        key,
        federation: c.federation ?? null,
        label: c.federation?.region ?? c.region ?? c.federation?.shortName ?? '',
        comps: [],
      };
      groups.set(key, g);
    }
    g.comps.push(c);
  }
  const regional = [...groups.values()]
    .map((g) => ({ ...g, comps: orderByImportance(g.comps, locale) }))
    .sort((a, b) => {
      const oa = (a.federation && order.get(a.federation.code)) ?? 999;
      const ob = (b.federation && order.get(b.federation.code)) ?? 999;
      return oa !== ob ? oa - ob : a.label.localeCompare(b.label, locale);
    });

  return {
    mainLeagues: finalMain,
    otherLeagues: finalOther,
    leagues,
    cups,
    base,
    regional,
  };
}

/**
 * Árbol completo: internacional aparte y el resto por país. Los países se
 * ordenan por el `display_order` de su federación nacional (dato), y los que
 * no tienen federación, detrás y por nombre.
 */
export function buildCompetitionTree(
  comps: CompetitionSummary[],
  locale: string,
  federations?: Federation[],
  countryName: (code: string) => string = (c) => c,
): CompetitionTree {
  const international = orderByImportance(comps.filter(isInternational), locale);
  const byCountry = new Map<string, CompetitionSummary[]>();
  for (const c of comps) {
    if (isInternational(c)) continue;
    const code = competitionCountry(c) ?? 'ZZ';
    if (!byCountry.has(code)) byCountry.set(code, []);
    byCountry.get(code)!.push(c);
  }

  const nationalFed = new Map<string, Federation>();
  for (const f of federations ?? []) {
    if (f.level === 'national' && f.country) nationalFed.set(f.country.toUpperCase(), f);
  }

  const countries: CountryGroup[] = [...byCountry.entries()].map(([code, list]) => {
    const fromComp = list.find((c) => c.federation?.level === 'national')?.federation ?? null;
    return {
      code,
      federation: nationalFed.get(code) ?? fromComp,
      total: list.length,
      sections: buildCountrySections(list, locale, federations),
    };
  });
  countries.sort((a, b) => {
    if ((a.code === 'ZZ') !== (b.code === 'ZZ')) return a.code === 'ZZ' ? 1 : -1;
    const oa = nationalFed.get(a.code)?.displayOrder ?? 999;
    const ob = nationalFed.get(b.code)?.displayOrder ?? 999;
    return oa !== ob ? oa - ob : countryName(a.code).localeCompare(countryName(b.code), locale);
  });

  return { international, countries };
}
