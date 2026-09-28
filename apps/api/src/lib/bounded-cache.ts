/**
 * Caché en memoria de cardinalidad ACOTADA (#333).
 *
 * La micro-caché de /matches/current usaba las fechas de `?from=&to=` como clave.
 * Aunque `resolveCurrentWindow` acota la amplitud, las fechas son arbitrarias:
 * un rango distinto por día (o por bot) hacía crecer el Map sin límite. Con un
 * tope de entradas y evicción del más antiguo, la memoria queda ligada a
 * `maxEntries` sin tocar la semántica (sigue siendo una caché de TTL).
 *
 * Map conserva el orden de inserción: al escribir una clave existente la
 * movemos al final para que la evicción sea por uso (aproximación LRU).
 */
export function setBounded<K, V>(
  map: Map<K, V>,
  key: K,
  value: V,
  maxEntries: number,
): void {
  if (map.has(key)) map.delete(key);
  map.set(key, value);
  // Con un tope inválido (NaN, <1) se cachea como máximo una entrada.
  const limit = Number.isFinite(maxEntries) && maxEntries >= 1 ? Math.floor(maxEntries) : 1;
  while (map.size > limit) {
    const oldest = map.keys().next().value as K | undefined;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
}
