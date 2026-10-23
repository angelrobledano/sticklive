import type { FederationLevel, UpsertFederationInput } from '@sports/db';

/**
 * Validación pura de lo que llega al admin (federaciones y ranking).
 * Devuelve el input normalizado o un mensaje de error, nunca lanza.
 */

const LEVELS: readonly FederationLevel[] = ['world', 'continental', 'national', 'regional'];
const PARENT_LEVEL: Record<FederationLevel, FederationLevel | null> = {
  world: null, continental: 'world', national: 'continental', regional: 'national',
};

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

/** null/'' → null, entero en rango → número, otra cosa → error. undefined → no tocar. */
function smallInt(v: unknown, min: number, max: number): number | null | undefined | 'invalid' {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isInteger(n) && n >= min && n <= max ? n : 'invalid';
}

export function parseRankingBody(body: unknown):
  { ok: true; patch: { tier?: number | null; featuredRank?: number | null } } | { ok: false; error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const tier = smallInt(b['tier'], 1, 9);
  const featuredRank = smallInt(b['featuredRank'], 1, 999);
  if (tier === 'invalid') return { ok: false, error: 'tier must be an integer 1-9 or null' };
  if (featuredRank === 'invalid') return { ok: false, error: 'featuredRank must be an integer 1-999 or null' };
  if (tier === undefined && featuredRank === undefined) return { ok: false, error: 'nothing to update' };
  const patch: { tier?: number | null; featuredRank?: number | null } = {};
  if (tier !== undefined) patch.tier = tier;
  if (featuredRank !== undefined) patch.featuredRank = featuredRank;
  return { ok: true, patch };
}

/**
 * `code` es el texto exacto de competitions.organizer (no se normaliza: el JOIN
 * es por igualdad). `parentLevel` = nivel de la federación padre ya existente,
 * o null si no existe; el llamante lo consulta en BD.
 */
export function parseFederationBody(
  code: string,
  body: unknown,
  parentLevel: FederationLevel | null,
): { ok: true; input: UpsertFederationInput } | { ok: false; error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const c = str(code);
  if (!c || c.length > 60) return { ok: false, error: 'code required (max 60)' };
  const slug = str(b['slug']);
  if (!slug || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) return { ok: false, error: 'slug must be kebab-case [a-z0-9-]' };
  const name = str(b['name']);
  const shortName = str(b['shortName']) ?? c;
  if (!name) return { ok: false, error: 'name required' };
  const level = b['level'] as FederationLevel;
  if (!LEVELS.includes(level)) return { ok: false, error: `level must be one of ${LEVELS.join(', ')}` };

  const parentCode = str(b['parentCode']);
  const expectedParent = PARENT_LEVEL[level];
  if (expectedParent === null) {
    if (parentCode) return { ok: false, error: 'world federation cannot have parent' };
  } else {
    if (!parentCode) return { ok: false, error: `${level} federation needs a ${expectedParent} parent` };
    if (parentCode === c) return { ok: false, error: 'federation cannot be its own parent' };
    if (parentLevel !== expectedParent) return { ok: false, error: `parent must exist and be ${expectedParent}` };
  }

  const countryRaw = str(b['country']);
  const country = countryRaw ? countryRaw.toUpperCase() : null;
  if ((level === 'national' || level === 'regional') && !(country && /^[A-Z]{2}$/.test(country))) {
    return { ok: false, error: 'country (ISO-2) required for national/regional' };
  }
  const region = str(b['region']);
  if (level === 'regional' && !region) return { ok: false, error: 'region required for regional' };
  const website = str(b['website']);
  if (website && !/^https?:\/\//.test(website)) return { ok: false, error: 'website must be http(s)' };
  const order = smallInt(b['displayOrder'], 0, 9999);
  if (order === 'invalid') return { ok: false, error: 'displayOrder must be an integer 0-9999' };

  return {
    ok: true,
    input: {
      code: c, slug, name, shortName, level, parentCode: expectedParent ? parentCode : null,
      country: level === 'world' || level === 'continental' ? null : country,
      region: level === 'regional' ? region : null,
      website, displayOrder: order ?? 100,
    },
  };
}
