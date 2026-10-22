import type { CompetitionSummary } from './api/types';

export const IMPORTANCE: Record<string, number> = {
  // Mundiales World Skate Games (encima de todo mientras se disputan)
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

export function importanceRank(slug?: string | null): number {
  return (slug && IMPORTANCE[slug]) || RANK_DESCONOCIDA;
}

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
 * Ordena por importancia; empate → nombre en el locale. No muta la entrada.
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
