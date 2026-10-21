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
