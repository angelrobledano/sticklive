/**
 * Importancia de las competiciones (decisión de producto), compartida por el
 * listado de competiciones y la vista de partidos del día.
 *
 *  · `hasSeason2026`: solo se muestra lo que tiene temporada 2026/27.
 *  · `orderByImportance`: orden de mayor a menor importancia, indexado por
 *    `slug` (estable; el nombre es traducible). Genérico: ordena tanto la lista
 *    de competiciones como los bloques de la vista del día.
 *
 * Lógica pura y testeada (mismo patrón que `match-time.ts` / `format.ts`).
 */
import type { CompetitionSummary } from '@/lib/api/client';

const SEASON_LABEL = '2026/27';
const SEASON_YEAR = 2026;

/** ¿Esta competición tiene temporada 2026/27? (regla estricta: por nombre) */
export function hasSeason2026(c: CompetitionSummary): boolean {
  const name = c.season?.name ?? '';
  return name.includes(SEASON_LABEL) || name.includes(String(SEASON_YEAR));
}

/**
 * Importancia por competición (1 = máxima). Lo no listado va detrás de todo
 * (RANK_DESCONOCIDA).
 */
export const IMPORTANCE: Record<string, number> = {
  'ok-liga-masculina': 1,
  'ok-liga-femenina': 2,
  'copa-del-rey': 3,
  'copa-de-la-reina-iberdrola': 4,
  'supercopa-de-espana-masculina': 5,
  'supercopa-de-espana-femenina': 6,
  'ok-liga-plata-norte': 7,
  'ok-liga-plata-sur': 8,
  'ok-liga-plata-femenina': 9,
  'copa-sar-la-princesa-masculina': 10,
  'copa-sar-la-princesa-femenina': 11,
  'ok-liga-bronce-masculina-norte': 12,
  'ok-liga-bronce-masculina-sur': 13,
  'ok-liga-plata-masculina-eliminatoria': 14,
  'ok-liga-bronce-eliminatoria': 15,
};

const RANK_DESCONOCIDA = 1000;

export function importanceRank(slug?: string | null): number {
  return (slug && IMPORTANCE[slug]) || RANK_DESCONOCIDA;
}

/**
 * Ordena por importancia; empate → nombre en el locale. No muta la entrada.
 * Sirve para competiciones y para los bloques `{ slug, name, ... }` del día.
 */
export function orderByImportance<T extends { slug?: string | null; name: string }>(
  list: T[],
  locale: string,
): T[] {
  return [...list].sort((a, b) => {
    const d = importanceRank(a.slug) - importanceRank(b.slug);
    return d !== 0 ? d : a.name.localeCompare(b.name, locale);
  });
}
