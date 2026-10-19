import type { Locale } from '@/lib/locales';
import es from '@/locales/es.json';
import en from '@/locales/en.json';
import pt from '@/locales/pt.json';
import fr from '@/locales/fr.json';
import it from '@/locales/it.json';

/**
 * Etiqueta de sección para desambiguar equipos homónimos (F3-4).
 *
 * Un club puede tener varias secciones (masculino/femenino, senior/juvenil,
 * primer equipo/filial) y una selección nacional se repite por género y
 * categoría. El título SEO y la ficha deben poder distinguirlas sin depender
 * del nombre de la fuente.
 *
 * El masculino senior de primer equipo es el caso por defecto y no añade
 * tokens: "España" (masculina senior) vs "España (Femenina)" o
 * "España (Sub-19)". Así los títulos no se llenan de "Masculino · Senior".
 *
 * Pura: recibe `locale` y los campos de `teams`; no usa React ni i18n de cliente.
 */

type Dict = Record<string, unknown>;

const DICTS: Record<Locale, Dict> = { es, en, pt, fr, it };

const KNOWN_AGE_CATEGORIES = new Set([
  'senior', 'juvenil', 'junior', 'infantil', 'alevin', 'benjamin', 'prebenjamin', 'veteranos', 'base',
]);

export interface TeamSectionInput {
  gender?: string | null;
  ageCategory?: string | null;
  squadLevel?: number | null;
  teamType?: string | null;
}

function lookup(dict: Dict, path: string): string | null {
  let node: unknown = dict;
  for (const key of path.split('.')) {
    if (typeof node !== 'object' || node === null) return null;
    node = (node as Dict)[key];
  }
  return typeof node === 'string' ? node : null;
}

/** 'sub17' / 'Sub 19' / 'U19' → 'Sub-17'; categorías conocidas → su etiqueta. */
function ageCategoryLabel(raw: string | null | undefined, locale: Locale): string | null {
  if (!raw) return null;
  const key = raw.trim().toLowerCase().replace(/\s+/g, '');
  const sub = /^(?:sub|u)-?(\d{1,2})$/.exec(key);
  if (sub) return `Sub-${sub[1]}`;
  if (KNOWN_AGE_CATEGORIES.has(key)) {
    return lookup(DICTS[locale] ?? DICTS.es, `age_categories.${key}`);
  }
  return null;
}

/** 1 → ''; 2 → 'B'; 3 → 'C'… */
function squadLevelLetter(level: number | null | undefined): string {
  const n = typeof level === 'number' && Number.isFinite(level) ? Math.trunc(level) : 1;
  if (n < 2) return '';
  return String.fromCharCode(64 + Math.min(n, 26));
}

export function teamSectionLabel(team: TeamSectionInput, locale: Locale): string {
  const dict = DICTS[locale] ?? DICTS.es;
  const parts: string[] = [];

  const gender = team.gender?.trim().toLowerCase();
  // El masculino es el caso por defecto; el femenino sí desambigua.
  if (gender === 'female') {
    const female = lookup(dict, 'common.female');
    if (female) parts.push(female);
  }

  const age = ageCategoryLabel(team.ageCategory, locale);
  if (age && age.trim().toLowerCase() !== 'senior') parts.push(age);

  const letter = squadLevelLetter(team.squadLevel);
  if (letter) {
    const filial = lookup(dict, 'team.filial') ?? 'Filial';
    parts.push(`${filial} ${letter}`);
  }

  return parts.join(' · ');
}
