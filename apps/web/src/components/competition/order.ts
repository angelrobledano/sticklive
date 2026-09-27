/**
 * Curación del listado de competiciones (decisión de producto).
 *
 *  · Solo se muestran las competiciones con temporada **2026/27**: el resto no
 *    tiene nada que enseñar esta temporada (y `is_current` no sirve como filtro:
 *    una liga de cantera con 2025/26 como actual seguiría apareciendo).
 *  · El orden es de **importancia**, fijado por producto. Se indexa por `slug`
 *    (estable) y no por nombre (traducible).
 *
 * Lógica pura y testeada (mismo patrón que `format.ts`).
 */
import type { CompetitionSummary } from '@/lib/api/client';

const SEASON_LABEL = '2026/27';
const SEASON_YEAR = 2026;

/** ¿Esta competición tiene temporada 2026/27? */
export function hasSeason2026(c: CompetitionSummary): boolean {
  const name = c.season?.name ?? '';
  if (name.includes(SEASON_LABEL) || name.includes(String(SEASON_YEAR))) return true;
  const start = c.season?.startDate ? parseInt(c.season.startDate.slice(0, 4), 10) : NaN;
  return Number.isFinite(start) && start >= SEASON_YEAR;
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

export function importanceRank(c: CompetitionSummary): number {
  return IMPORTANCE[c.slug] ?? RANK_DESCONOCIDA;
}

/** Ordena por importancia; empate → nombre en el locale. No muta la entrada. */
export function orderByImportance(
  list: CompetitionSummary[],
  locale: string,
): CompetitionSummary[] {
  return [...list].sort((a, b) => {
    const d = importanceRank(a) - importanceRank(b);
    return d !== 0 ? d : a.name.localeCompare(b.name, locale);
  });
}
