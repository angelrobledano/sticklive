/**
 * Registro de federaciones autonómicas en sidgad.
 *
 * Descubrimiento: todos los portales siguen el patrón
 *   https://www.server2.sidgad.es/{prefix}/{prefix}_ls_1.php
 * y COMPARTEN el diccionario de temporadas (temp_39 = 2025/26 en todos).
 *
 * Para añadir una federación: comprobar que su _ls_1.php responde y
 * añadir una línea aquí.
 */

export interface Federation {
  org: string;       // sigla → competitions.organizer y prefijo de slug
  region: string;    // competitions.region
  prefix: string;    // prefijo sidgad (SIDGAD_PORTAL)
  referer: string;   // home del portal (SIDGAD_REFERER)
}

export const FEDERATIONS: Federation[] = [
  { org: 'FMP',    region: 'Madrid',               prefix: 'fmp',    referer: 'https://www.hockeypatines.fmp.es/' },
  { org: 'FAP',    region: 'Andalucía',            prefix: 'fap',    referer: 'https://www.hockeypatines.fapatinaje.org/' },
  { org: 'FECAPA', region: 'Cataluña',             prefix: 'fecapa', referer: 'https://www.fecapa.cat/' },
  { org: 'FPCV',   region: 'Comunidad Valenciana', prefix: 'fpcv',   referer: 'https://www.hockeypatines.fpcv.es/' },
  { org: 'FNP',    region: 'Navarra',              prefix: 'fnp',    referer: 'https://www.hockey.fnp.org/' },
  { org: 'FGP',    region: 'Galicia',              prefix: 'fgpatinaxe', referer: 'https://www.hockeypatines.fgpatinaxe.gal/' },
  // Italia (FISR, hockeypista.fisr.it): mismo sidgad y mismos temp_ (41 = 2026/27).
  // NO es una autonómica: país IT y hora local Europe/Rome. Alta con revisión
  // del catálogo (--catalog-only), no con la siembra masiva de import-history.
  { org: 'FISR',   region: 'Italia',               prefix: 'fisr',   referer: 'https://hockeypista.fisr.it/' },
];

/**
 * temp_id → etiqueta de temporada. Serie observada (rfep y fap):
 *   39→2025/26, 37→2024/25, 35→2023/24, 33→2022/23, 31→2021/22, 29→2020/21
 * Fórmula lineal: startYear = 2020 + (id - 29) / 2 (ids impares).
 */
export function seasonLabelFromTempId(tempId: string): string | null {
  const id = Number(tempId);
  if (!Number.isInteger(id) || id < 1 || id > 45 || id % 2 === 0) return null;
  const startYear = 2020 + (id - 29) / 2;
  const end = String((startYear + 1) % 100).padStart(2, '0');
  return `Temporada ${startYear}/${end}`;
}
