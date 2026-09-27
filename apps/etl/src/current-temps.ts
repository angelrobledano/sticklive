/**
 * Temporada vigente del catálogo (#166).
 *
 * `import-history` fijaba `is_current` a `tempId === '39'` (2025/26) a mano, así
 * que en cuanto la FEP publicó la 2026/27 ninguna temporada habría quedado
 * marcada como actual. En su lugar se deriva del catálogo: por cada competición
 * (clave canónica) es actual la de `tempId` máximo.
 *
 * Lógica pura para poder testearla sin BD ni side effects.
 */

export interface TempEntry {
  /** Clave de agrupación (p. ej. el slug canónico de la competición). */
  key: string;
  tempId: string | null;
}

/**
 * Por cada clave, el `tempId` de la temporada vigente (el máximo). El tempId de
 * la fuente es numérico y crece con la temporada; se compara como número (no como
 * texto: '9' < '10'). Se ignoran los nulos, vacíos o no numéricos.
 */
export function maxTempIdByKey(entries: TempEntry[]): Map<string, string> {
  const max = new Map<string, string>();
  for (const { key, tempId } of entries) {
    if (tempId == null || tempId === '') continue;
    const n = Number(tempId);
    if (!Number.isFinite(n)) continue;
    const prev = max.get(key);
    if (prev == null || n > Number(prev)) max.set(key, tempId);
  }
  return max;
}
