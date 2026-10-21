import type { CompetitionSummary } from './api/types';
import { importanceRank, orderByImportance } from './competition-importance';

export const COUNTRY_ORDER = ['ES', 'PT', 'IT', 'FR', 'AR', 'AN'];

export function countrySortKey(code: string | null): number {
  const i = COUNTRY_ORDER.indexOf((code ?? '').toUpperCase());
  return i === -1 ? 100 : i;
}

export function countryDisplayName(code: string | null, locale: string): string {
  if (!code) return '';
  try {
    return new Intl.DisplayNames([locale], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

export function genderLabel(gender: string | null, t: (k: string) => string): string {
  if (gender === 'male') return t('common.male');
  if (gender === 'female') return t('common.female');
  return '';
}

export function normalizeSearchText(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function nameVariants(c: CompetitionSummary): string[] {
  return c.nameI18n ? Object.values(c.nameI18n) : [];
}

export function matchesCompetitionQuery(
  c: CompetitionSummary,
  normalizedQuery: string,
  countryName: string,
): boolean {
  return (
    normalizeSearchText(c.name).includes(normalizedQuery) ||
    nameVariants(c).some((n) => normalizeSearchText(n).includes(normalizedQuery)) ||
    normalizeSearchText(c.shortName ?? '').includes(normalizedQuery) ||
    normalizeSearchText(countryName).includes(normalizedQuery) ||
    normalizeSearchText(c.region ?? '').includes(normalizedQuery) ||
    normalizeSearchText(c.organizer).includes(normalizedQuery)
  );
}

export function filterCompetitions(
  comps: CompetitionSummary[],
  query: string,
  countryNameFor: (code: string | null) => string,
): CompetitionSummary[] {
  const q = normalizeSearchText(query.trim());
  if (!q) return comps;
  return comps.filter((c) => matchesCompetitionQuery(c, q, countryNameFor(c.country)));
}

function textRelevance(text: string, normalizedQuery: string): number {
  const n = normalizeSearchText(text);
  if (!n) return 3;
  if (n === normalizedQuery) return 0;
  if (n.startsWith(normalizedQuery)) return 1;
  if (n.split(/\s+/).some((word) => word.startsWith(normalizedQuery))) return 2;
  return 3;
}

export function matchRelevance(c: CompetitionSummary, normalizedQuery: string): number {
  if (!normalizedQuery) return 3;
  const fields = [c.name, ...nameVariants(c), c.shortName ?? ''];
  return Math.min(...fields.map((f) => textRelevance(f, normalizedQuery)));
}

export function orderSearchResults(
  comps: CompetitionSummary[],
  normalizedQuery: string,
  locale: string,
): CompetitionSummary[] {
  if (!normalizedQuery) return orderByImportance(comps, locale);
  return [...comps].sort((a, b) => {
    const byRelevance = matchRelevance(a, normalizedQuery) - matchRelevance(b, normalizedQuery);
    if (byRelevance !== 0) return byRelevance;
    const byImportance = importanceRank(a.slug) - importanceRank(b.slug);
    return byImportance !== 0 ? byImportance : a.name.localeCompare(b.name, locale);
  });
}

export interface CompetitionsIndex {
  international: CompetitionSummary[];
  byCountry: [string, CompetitionSummary[]][];
}

export function groupCompetitionsForIndex(
  competitions: CompetitionSummary[],
  locale: string,
): CompetitionsIndex {
  const international = orderByImportance(
    competitions.filter((c) => c.scope === 'international'),
    locale,
  );
  const map = new Map<string, CompetitionSummary[]>();
  for (const c of competitions.filter((c) => c.scope !== 'international')) {
    const key = c.country ?? 'ZZ';
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(c);
  }
  for (const [k, arr] of map) map.set(k, orderByImportance(arr, locale));
  const byCountry = [...map.entries()].sort(([a], [b]) => {
    const ks = countrySortKey(a) - countrySortKey(b);
    return ks !== 0 ? ks : countryDisplayName(a, locale).localeCompare(countryDisplayName(b, locale), locale);
  });
  return { international, byCountry };
}
