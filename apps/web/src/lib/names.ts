/**
 * Sistema global de formato de nombres (equipos y jugadores).
 * Regla transversal de la app:
 *  · Clubes: nombre oficial en Sentence case en escritorio; corto/siglas en móvil.
 *  · Jugadores: SIEMPRE "Nombre Apellido" en Sentence case (primer apellido).
 */

export function toTitleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/(^|\s|-|')\p{L}/gu, (m) => m.toUpperCase());
}

// Conectores españoles → siempre en minúscula (salvo si es la primera palabra).
const CONNECTORS = new Set([
  'de', 'del', 'la', 'las', 'el', 'los', 'lo', 'y', 'e', 'o', 'u', 'a', 'al', 'con', 'en', 'por', 'para',
]);
// Palabras cortas en mayúsculas que NO son siglas (deben ir en Título), para que
// la heurística de "≤3 letras = sigla" no las deje gritadas (REY, SUR…).
const FORCE_TITLE = new Set(['REY', 'SUR']);

/**
 * "IGUALADA RIGAT HC" → "Igualada Rigat HC"; "COPA DEL REY" → "Copa del Rey".
 * Conserva siglas reales (OK, SAR, HC, CP…), baja conectores y pone en Título el resto.
 */
export function clubName(name: string): string {
  return name
    .split(/\s+/)
    .map((w, i) => {
      const lower = w.toLowerCase();
      if (i > 0 && CONNECTORS.has(lower)) return lower;
      const isAcronym = w.length <= 3 && w === w.toUpperCase() && !FORCE_TITLE.has(w.toUpperCase());
      return isAcronym ? w : w.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(' ');
}

/** Desde first/last de la API: "FERRAN" + "FONT SÁNCHEZ" → "Ferran Font" */
export function playerDisplayName(firstName: string, lastName: string): string {
  const surname = lastName.trim().split(/\s+/)[0] ?? '';
  return toTitleCase(`${firstName} ${surname}`.trim());
}

/** Desde el nombre crudo de la fuente: "ALABART GONZALEZ IGNACIO" → "Ignacio Alabart" */
export function playerNameFromRaw(raw: string): string {
  const parts = raw.replace(/\s+/g, ' ').trim().split(' ');
  if (parts.length === 1) return toTitleCase(parts[0]!);
  return toTitleCase(`${parts[parts.length - 1]} ${parts[0]}`);
}
