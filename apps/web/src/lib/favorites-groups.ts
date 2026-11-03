/**
 * Favoritos agrupados (auditoría UX 03/11/2026, #3). Antes, `/favorites` era
 * una lista alfabética de ~170 ligas: encontrar la tuya costaba minutos.
 *
 *   1. Las que ya sigues.
 *   2. Las destacadas (`featuredRank`), en su orden.
 *   3. El resto por país (el preferido primero, luego por volumen) →
 *      federación (nacional antes que regional) → ligas por importancia.
 *
 * Cada liga sale una sola vez. Función pura: la página solo pinta.
 */
import { importanceRank } from '@/lib/competition-importance';

export interface GroupableLeague {
  id: string;
  name: string;
  country: string | null;
  featuredRank: number | null;
  tier: number | null;
  federation: { code: string; name: string; level: string } | null;
}

export interface FederationGroup<T> { code: string; name: string; leagues: T[] }
export interface CountryGroup<T> { country: string; count: number; federations: FederationGroup<T>[] }
export interface FavoriteLeagueGroups<T> { following: T[]; featured: T[]; countries: CountryGroup<T>[] }

const LEVEL_ORDER: Record<string, number> = { world: 0, continental: 1, national: 2, regional: 3 };

function byImportance<T extends GroupableLeague>(a: T, b: T): number {
  return importanceRank(a) - importanceRank(b) || a.name.localeCompare(b.name, 'es');
}

export function groupFavoriteLeagues<T extends GroupableLeague>(
  leagues: readonly T[],
  opts: { followedIds: readonly string[]; country?: string | null },
): FavoriteLeagueGroups<T> {
  const followed = new Set(opts.followedIds);
  const following = leagues.filter((l) => followed.has(l.id)).sort(byImportance);
  const featured = leagues
    .filter((l) => !followed.has(l.id) && l.featuredRank != null)
    .sort((a, b) => a.featuredRank! - b.featuredRank! || a.name.localeCompare(b.name, 'es'));

  const byCountry = new Map<string, Map<string, FederationGroup<T> & { level: number }>>();
  for (const l of leagues) {
    if (followed.has(l.id) || l.featuredRank != null) continue;
    const country = l.country ?? 'W';
    const feds = byCountry.get(country) ?? new Map();
    byCountry.set(country, feds);
    const code = l.federation?.code ?? '__other__';
    let fed = feds.get(code);
    if (!fed) {
      fed = { code, name: l.federation?.name ?? '', level: LEVEL_ORDER[l.federation?.level ?? ''] ?? 9, leagues: [] };
      feds.set(code, fed);
    }
    fed.leagues.push(l);
  }

  const countries: CountryGroup<T>[] = [...byCountry.entries()].map(([country, feds]) => {
    const federations = [...feds.values()]
      .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name, 'es'))
      .map(({ code, name, leagues: ls }) => ({ code, name, leagues: ls.sort(byImportance) }));
    return { country, count: federations.reduce((n, f) => n + f.leagues.length, 0), federations };
  });
  countries.sort((a, b) =>
    Number(b.country === opts.country) - Number(a.country === opts.country) || b.count - a.count);

  return { following, featured, countries };
}
