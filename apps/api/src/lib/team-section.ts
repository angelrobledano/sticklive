/**
 * #196/#197 — Lógica pura del modelo de secciones de club.
 *
 * En hockey patines un club tiene varias "secciones" (club × género × categoría ×
 * filial; migraciones 032/044) que comparten nombre comercial y escudo. `teams`
 * representa una sección. Estos helpers derivan la etiqueta compacta que
 * desambigua dos secciones homónimas y fijan un orden estable para el bloque
 * "otros equipos del club".
 *
 * No conocen i18n: las siglas M/F y las letras de filial B/C son neutras en los
 * 5 idiomas del producto. La categoría de edad no entra en el sufijo (no tiene
 * sigla neutra); la ficha la muestra con su etiqueta completa.
 */

export type TeamGender = 'male' | 'female' | 'mixed' | 'unknown';

/** Campos mínimos de una fila de `teams` que describen su sección. */
export interface TeamSectionFields {
  gender?: string | null;
  age_category?: string | null;
  squad_level?: number | null;
  team_type?: string | null;
}

/** Otro equipo del mismo club, tal como lo devuelve la consulta de `team-detail`. */
export interface ClubTeamRow extends TeamSectionFields {
  id: string;
  name: string;
  short_name: string | null;
  logo_url: string | null;
}

const GENDER_VALUES: readonly TeamGender[] = ['male', 'female', 'mixed', 'unknown'];

/** Normaliza `teams.gender` a la escala cerrada de la migración 032; null si no encaja. */
export function normalizeGender(raw: string | null | undefined): TeamGender | null {
  if (!raw) return null;
  const v = raw.trim().toLowerCase();
  return (GENDER_VALUES as readonly string[]).includes(v) ? (v as TeamGender) : null;
}

/**
 * Letra de filial: nivel 1 (primer equipo) → '' (sin sufijo); 2 → 'B', 3 → 'C'…
 * Los niveles fuera de rango se recortan a 'Z' para no generar caracteres raros.
 */
export function squadLevelLetter(level: number | null | undefined): string {
  const n = typeof level === 'number' && Number.isFinite(level) ? Math.trunc(level) : 1;
  if (n < 2) return '';
  return String.fromCharCode(64 + Math.min(n, 26)); // 2→B … 26→Z
}

/**
 * Sufijo compacto para listas: 'F' (femenino), 'B' (filial), 'F · B'. Vacío para
 * el primer equipo masculino o cuando no hay datos de género/filial: el masculino
 * de primer equipo es el caso por defecto y no necesita token para diferenciarse.
 */
export function sectionSuffix(row: TeamSectionFields): string {
  const parts: string[] = [];
  if (normalizeGender(row.gender) === 'female') parts.push('F');
  const letter = squadLevelLetter(row.squad_level);
  if (letter) parts.push(letter);
  return parts.join(' · ');
}

const GENDER_RANK: Record<TeamGender, number> = { male: 0, female: 1, mixed: 2, unknown: 3 };

/**
 * Orden determinista de las secciones de un club:
 * género (M → F → mixto → desconocido) → categoría → filial → nombre.
 * Devuelve una copia: no muta la entrada.
 */
export function orderClubTeams<T extends TeamSectionFields & { name: string }>(
  teams: readonly T[],
): T[] {
  return [...teams].sort((a, b) => {
    const ga = GENDER_RANK[normalizeGender(a.gender) ?? 'unknown'];
    const gb = GENDER_RANK[normalizeGender(b.gender) ?? 'unknown'];
    if (ga !== gb) return ga - gb;

    const aa = (a.age_category ?? '').trim().toLowerCase();
    const ab = (b.age_category ?? '').trim().toLowerCase();
    if (aa !== ab) return aa < ab ? -1 : 1;

    const la = a.squad_level ?? 1;
    const lb = b.squad_level ?? 1;
    if (la !== lb) return la - lb;

    return a.name.localeCompare(b.name, 'es');
  });
}
