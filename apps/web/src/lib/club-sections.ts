/**
 * Equipos de un club por sección (spec 2026-10-30, referencia OKmob): sénior,
 * sénior femenino, base (de mayor a menor edad) y veteranos. Cada equipo se
 * nombra por su categoría y letra («Alevín C»), no por el nombre del club, que
 * es el mismo en todos. Funciones puras, testeadas; las usan la ficha de club y
 * el bloque «Otros equipos del club» de la ficha de equipo.
 */
import type { Locale } from '@/lib/locales';
import es from '@/locales/es.json';
import ca from '@/locales/ca.json';
import en from '@/locales/en.json';
import pt from '@/locales/pt.json';
import fr from '@/locales/fr.json';
import it from '@/locales/it.json';

export type ClubSection = 'senior' | 'senior_female' | 'base' | 'veterans';
export const CLUB_SECTIONS: readonly ClubSection[] = ['senior', 'senior_female', 'base', 'veterans'];

export interface ClubSectionTeam {
  /** De la API (`clubSection`); si falta, se deduce. */
  section?: string | null;
  ageCategory?: string | null;
  gender?: string | null;
  squadLevel?: number | null;
}

/** De mayor a menor edad, como lo lee la gente. */
const AGE_ORDER = ['senior', 'sub23', 'junior', 'juvenil', 'infantil', 'alevin', 'benjamin', 'prebenjamin', 'base', 'veteranos'];

const age = (t: ClubSectionTeam) => (t.ageCategory ?? '').trim().toLowerCase() || 'senior';

export function sectionOf(t: ClubSectionTeam): ClubSection {
  if (t.section && (CLUB_SECTIONS as readonly string[]).includes(t.section)) return t.section as ClubSection;
  const a = age(t);
  if (a === 'veteranos') return 'veterans';
  if (a !== 'senior') return 'base';
  return t.gender === 'female' ? 'senior_female' : 'senior';
}

function ageRank(t: ClubSectionTeam): number {
  const a = age(t);
  const i = AGE_ORDER.indexOf(a);
  if (i !== -1) return i;
  const sub = /^(?:sub|u)-?(\d{1,2})$/.exec(a);
  return sub ? 1 + (23 - Number(sub[1])) / 100 : AGE_ORDER.length;
}

export function groupClubSections<T extends ClubSectionTeam>(teams: readonly T[]): { section: ClubSection; teams: T[] }[] {
  const by = new Map<ClubSection, T[]>();
  for (const t of teams) {
    const s = sectionOf(t);
    by.set(s, [...(by.get(s) ?? []), t]);
  }
  return CLUB_SECTIONS.filter((s) => by.has(s)).map((section) => ({
    section,
    teams: [...by.get(section)!].sort((a, b) =>
      ageRank(a) - ageRank(b)
      || Number(a.gender === 'female') - Number(b.gender === 'female')
      || (a.squadLevel ?? 1) - (b.squadLevel ?? 1)),
  }));
}

type Dict = Record<string, unknown>;
const DICTS: Record<Locale, Dict> = { es, ca, en, pt, fr, it };

function lookup(locale: Locale, path: string): string | null {
  let node: unknown = DICTS[locale] ?? DICTS.es;
  for (const k of path.split('.')) {
    if (typeof node !== 'object' || node === null) return null;
    node = (node as Dict)[k];
  }
  return typeof node === 'string' ? node : null;
}

/** «Alevín C», «Infantil femenino», «Senior B», «Sub-23». */
export function clubTeamLabel(t: ClubSectionTeam, locale: Locale): string {
  const a = age(t);
  const sub = /^(?:sub|u)-?(\d{1,2})$/.exec(a);
  const parts = [sub ? `Sub-${sub[1]}` : (lookup(locale, `age_categories.${a}`) ?? a)];
  const n = t.squadLevel ?? 1;
  if (n >= 2) parts.push(String.fromCharCode(64 + Math.min(n, 26)));
  if (t.gender === 'female' && sectionOf(t) === 'base') parts.push(lookup(locale, 'club.female_team') ?? 'femenino');
  return parts.join(' ');
}

/** Texto `club.*` del diccionario, para componentes de servidor. */
export function clubText(locale: Locale, key: string, fallback: string): string {
  return lookup(locale, `club.${key}`) ?? fallback;
}
