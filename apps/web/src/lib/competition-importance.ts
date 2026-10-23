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
import type { CompetitionSummary } from '@/lib/api/client';

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

/**
 * LEGADO: importancia por slug. La fuente de verdad es ya la BD
 * (`competitions.featured_rank` + `competitions.tier`, migración 089), que
 * llega en el listado. Este mapa solo se usa como respaldo cuando el objeto
 * no trae esos campos (bloques de la vista del día, que se construyen desde
 * los partidos). Borrar cuando /matches exponga featured_rank.
 */
export const IMPORTANCE: Record<string, number> = {
  'mundial-masculino-worldskate': 1,
  'mundial-femenino-worldskate': 2,
  'intercontinental-masculino-worldskate': 3,
  'mundial-sub19-masculino-worldskate': 4,
  'ok-liga-masculina': 5,
  'ok-liga-femenina': 6,
  'copa-del-rey': 7,
  'copa-de-la-reina-iberdrola': 8,
  'supercopa-de-espana-masculina': 9,
  'supercopa-de-espana-femenina': 10,
  'ok-liga-plata-norte': 11,
  'ok-liga-plata-sur': 12,
  'ok-liga-plata-femenina': 13,
  'copa-sar-la-princesa-masculina': 14,
  'copa-sar-la-princesa-femenina': 15,
  'ok-liga-bronce-masculina-norte': 16,
  'ok-liga-bronce-masculina-sur': 17,
  'ok-liga-plata-masculina-eliminatoria': 18,
  'ok-liga-bronce-eliminatoria': 19,
};

const RANK_DESCONOCIDA = 1000;
/** Base del rango por tier: detrás de cualquier destacada (featured_rank < 500). */
const TIER_BASE = 500;

/** Lo que hace falta para ordenar: slug y, si vienen, los campos de datos. */
export interface Rankable {
  slug?: string | null;
  featuredRank?: number | null;
  tier?: number | null;
}

/**
 * Rango de importancia (menor = más importante):
 *   1. `featuredRank` (curación editorial en BD)
 *   2. mapa legado por slug (solo si el objeto no trae datos)
 *   3. `tier` → 500 + tier·10 (máxima categoría de cada país antes que la 2ª)
 *   4. resto → 1000
 */
export function importanceRank(item?: Rankable | string | null): number {
  const it: Rankable = typeof item === 'string' || item == null ? { slug: item ?? null } : item;
  if (it.featuredRank != null && it.featuredRank > 0) return it.featuredRank;
  if (it.featuredRank === undefined && it.slug && IMPORTANCE[it.slug]) return IMPORTANCE[it.slug]!;
  if (it.tier != null && it.tier > 0) return TIER_BASE + it.tier * 10;
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
