import { isCompetitionSlug as isPublicSlug } from './competition-key.js';

/**
 * Validación del PATCH /admin/clubs/:id (Plan B1). El nombre canónico es el H1
 * y el title de la ficha de club; el slug, su URL. Lógica pura y testeada.
 */
export interface ClubPatch {
  canonicalName?: string;
  slug?: string;
  city?: string | null;
}

export const MAX_CLUB_NAME = 120;
export const MAX_CLUB_CITY = 80;

function clean(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function hasControlChars(value: string): boolean {
  for (const ch of value) {
    const code = ch.codePointAt(0)!;
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

export function parseClubPatch(body: unknown): { ok: true; patch: ClubPatch } | { ok: false; error: string } {
  if (!body || typeof body !== 'object') return { ok: false, error: 'body must be an object' };
  const b = body as Record<string, unknown>;
  const patch: ClubPatch = {};

  if (Object.hasOwn(b, 'canonicalName')) {
    if (typeof b['canonicalName'] !== 'string') return { ok: false, error: 'canonicalName must be a string' };
    const name = clean(b['canonicalName']);
    if (!name) return { ok: false, error: 'canonicalName cannot be empty' };
    if (name.length > MAX_CLUB_NAME) return { ok: false, error: `canonicalName must be at most ${MAX_CLUB_NAME} characters` };
    if (hasControlChars(name)) return { ok: false, error: 'canonicalName contains control characters' };
    patch.canonicalName = name;
  }

  if (Object.hasOwn(b, 'slug')) {
    if (typeof b['slug'] !== 'string') return { ok: false, error: 'slug must be a string' };
    const slug = b['slug'].trim().toLowerCase();
    if (!isPublicSlug(slug)) return { ok: false, error: 'slug must be lowercase letters, digits and single hyphens' };
    patch.slug = slug;
  }

  if (Object.hasOwn(b, 'city')) {
    if (b['city'] !== null && typeof b['city'] !== 'string') return { ok: false, error: 'city must be a string or null' };
    const city = b['city'] === null ? null : clean(b['city']) || null;
    if (city && city.length > MAX_CLUB_CITY) return { ok: false, error: `city must be at most ${MAX_CLUB_CITY} characters` };
    if (city && hasControlChars(city)) return { ok: false, error: 'city contains control characters' };
    patch.city = city;
  }

  if (Object.keys(patch).length === 0) return { ok: false, error: 'nothing to update' };
  return { ok: true, patch };
}

/** Slug sugerido a partir del nombre: sin acentos, minúsculas, guiones. */
export function slugifyClubName(name: string): string {
  return name
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
