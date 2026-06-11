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

/** "IGUALADA RIGAT HC" → "Igualada Rigat HC" (siglas ≤3 letras se conservan) */
export function clubName(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => (w.length <= 3 && w === w.toUpperCase() ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
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
