/**
 * Importancia de las competiciones (decisión de producto), compartida por el
 * listado de competiciones y la vista de partidos del día.
 *
 *  · `currentSeasonYear` + `hasSeasonYear`: solo se muestra lo que tiene la
 *    temporada vigente, cuyo año se deriva de los datos (antes hardcodeado).
 *  · `orderByImportance`: orden de mayor a menor importancia, indexado por
 *    `slug` (estable; el nombre es traducible). Genérico: ordena tanto la lista
 *    de competiciones como los bloques de la vista del día.
 *
 * Lógica pura y testeada (mismo patrón que `match-time.ts` / `format.ts`).
 */
import type { CompetitionSummary } from './api';

/**
 * Año de la temporada vigente según los datos: el mayor año de 4 dígitos que
 * aparece en los nombres de temporada (p. ej. 2026 en «2026/27»). Derivarlo evita
 * el `2026` hardcodeado, que en verano de 2027 dejaría la portada vacía (#172).
 * Ignora «Histórico» (no es una temporada real).
 */
export function currentSeasonYear(comps: CompetitionSummary[]): number | null {
  let max: number | null = null;
  for (const c of comps) {
    const name = c.season?.name;
    if (!name || /hist[oó]rico/i.test(name)) continue;
    const m = name.match(/\d{4}/);
    if (!m) continue;
    const y = Number(m[0]);
    if (Number.isFinite(y) && (max == null || y > max)) max = y;
  }
  return max;
}

/** ¿Esta competición incluye la temporada `year`? (regla estricta: por nombre) */
export function hasSeasonYear(c: CompetitionSummary, year: number): boolean {
  const name = c.season?.name ?? '';
  return name.includes(String(year));
}

const RANK_DESCONOCIDA = 1000;
/** Base del rango por tier: detrás de cualquier destacada (featured_rank < 500). */
const TIER_BASE = 500;

/**
 * Lo que hace falta para ordenar. La importancia vive en la BD
 * (`competitions.featured_rank` + `competitions.tier`, migración 089), se
 * edita desde el admin y llega en /competitions, /matches/current y /live.
 */
export interface Rankable {
  slug?: string | null;
  featuredRank?: number | null;
  tier?: number | null;
}

/**
 * Rango de importancia (menor = más importante):
 *   1. `featuredRank` (curación editorial)
 *   2. `tier` → 500 + tier·10 (máxima categoría de cada país antes que la 2ª)
 *   3. resto → 1000
 */
export function importanceRank(item?: Rankable | null): number {
  if (!item) return RANK_DESCONOCIDA;
  if (item.featuredRank != null && item.featuredRank > 0) return item.featuredRank;
  if (item.tier != null && item.tier > 0) return TIER_BASE + item.tier * 10;
  return RANK_DESCONOCIDA;
}

/**
 * Ordena por importancia; empate → nombre en el locale. No muta la entrada.
 * Sirve para competiciones y para los bloques `{ slug, name, ... }` del día.
 */
export function orderByImportance<T extends Rankable & { name: string }>(
  list: T[],
  locale: string,
): T[] {
  return [...list].sort((a, b) => {
    const d = importanceRank(a) - importanceRank(b);
    return d !== 0 ? d : a.name.localeCompare(b.name, locale);
  });
}
