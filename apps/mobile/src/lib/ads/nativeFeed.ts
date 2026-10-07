/**
 * Colocación del native in-feed (Plan D Task 6): puro y testeado — los tests
 * no renderizan (patrón del repo: adfree.ts, fullscreen.ts).
 */

/**
 * Posiciones donde insertar el item sintético del native ad en una lista de
 * `itemCount` items de datos: tras cada `everyNItems` items (índice de splice
 * sobre la lista ORIGINAL: `insertNativeAdPositions(20, 8)` ⇒ [8], el anuncio
 * ocupa la 9ª posición, tras el 8º item).
 *
 * `everyNItems` llega de `config.nativeFeed` (useAdsConfig): el llamador pasa
 * `undefined` si la config no está cargada o el formato está disabled ⇒ sin
 * items sintéticos (fail-safe: los malos datos o su ausencia NUNCA activan
 * anuncios). Valores basura (0, negativos, decimales, NaN) ⇒ [].
 *
 * v1: UN SOLO punto de inserción por pantalla — el patrón "cada N" devolvería
 * [N, 2N, 3N, …] y cada punto monta un <NativeFeedAd> que pide su propio
 * anuncio; acotar a [N] garantiza un único native a la vez por pantalla
 * (decisión del plan: cada N ≥ 8 y solo el primer punto).
 */
export function insertNativeAdPositions(
  itemCount: number,
  everyNItems: number | null | undefined,
): number[] {
  if (typeof everyNItems !== 'number' || !Number.isInteger(everyNItems) || everyNItems < 1) {
    return [];
  }
  if (itemCount < everyNItems) return [];
  return [everyNItems];
}
