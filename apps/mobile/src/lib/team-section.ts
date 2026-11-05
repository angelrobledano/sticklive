import type { TeamSeason } from '@sports/core/api';

/** Categorías con etiqueta propia en `age_categories.*` (migración 017). */
const KNOWN_AGE_CATEGORIES = new Set([
  'senior', 'juvenil', 'junior', 'infantil', 'alevin', 'benjamin', 'prebenjamin', 'veteranos', 'base',
]);

/**
 * #196: letra de filial ('B','C'…) para el badge; '' para el primer equipo.
 * Espeja `squadLevelLetter` de `apps/api/src/lib/team-section.ts`.
 */
export function squadLevelLetter(level: number | null | undefined): string {
  const n = typeof level === 'number' && Number.isFinite(level) ? Math.trunc(level) : 1;
  if (n < 2) return '';
  return String.fromCharCode(64 + Math.min(n, 26));
}

/** Categoría de edad visible: 'sub19' → 'Sub-19'; conocidas → etiqueta i18n. */
export function ageCategoryLabel(raw: string | null | undefined, t: (key: string) => string): string | null {
  if (!raw) return null;
  const key = raw.trim().toLowerCase().replace(/\s+/g, '');
  const sub = /^(?:sub|u)-?(\d{1,2})$/.exec(key);
  if (sub) return `Sub-${sub[1]}`;
  return KNOWN_AGE_CATEGORIES.has(key) ? t(`age_categories.${key}`) : null;
}

/**
 * #196: etiqueta legible de la sección (género · categoría · filial) para
 * desambiguar dos fichas del mismo club. Pura: recibe `t` para testearla.
 * Devuelve '' si no hay nada que mostrar.
 */
export function sectionBadgeText(
  team: { gender?: string | null; ageCategory?: string | null; squadLevel?: number | null },
  t: (key: string) => string,
): string {
  const parts: string[] = [];
  if (team.gender === 'female') parts.push(t('common.female'));
  else if (team.gender === 'male') parts.push(t('common.male'));
  const age = ageCategoryLabel(team.ageCategory, t);
  if (age) parts.push(age);
  const letter = squadLevelLetter(team.squadLevel);
  if (letter) parts.push(`${t('team.filial')} ${letter}`);
  return parts.join(' · ');
}

/**
 * Etiqueta de una opción del selector de temporada: "Competición · 2025/26"
 * (+ "· Actual" si es la vigente). Pura: recibe `t` para testearla sin i18n.
 */
export function seasonOptionLabel(s: TeamSeason, t: (key: string) => string): string {
  const comp = s.competitionShort ?? s.competitionName;
  return `${comp} · ${s.name}${s.isCurrent ? ` · ${t('common.current')}` : ''}`;
}

export const STAFF_ROLE_LABELS: Record<string, string> = {
  E: 'team.coach',
  E1: 'team.coach',
  E2: 'team.coach2',
  A: 'team.assistant',
  D: 'team.delegate',
};

export function staffDisplayName(raw: string): string {
  // "ARES LOZANO RICARDO" → "Ricardo Ares"
  const clean = raw.trim().replace(/\s+/g, ' ');
  const parts = clean.split(' ');
  const title = (s: string) => s.toLowerCase().replace(/(^|\s|-)\p{L}/gu, (m) => m.toUpperCase());
  if (parts.length === 1) return title(clean);
  return title(`${parts[parts.length - 1]} ${parts[0]}`);
}
