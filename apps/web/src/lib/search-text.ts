/**
 * Normalización de texto para búsquedas locales (cliente).
 *
 * Minúsculas y sin diacríticos: `patin` encuentra `PATÍN`, `mataro` encuentra
 * `MATARÓ`, `iruna` encuentra `IRUÑA`. Mismo criterio que la búsqueda global de
 * la API (`normalizeSearchTerm`), para que lo que encuentra la web coincida con
 * lo que encuentra el buscador del servidor.
 *
 * Vive en `lib/` porque lo comparten módulos de `components/` y páginas.
 */
export function normalizeSearchText(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}
