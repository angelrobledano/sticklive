/**
 * Normalización determinista de nombres de club/equipo para el embudo de
 * Entity Resolution (escalón 2 «alias exacto» y, más adelante, el fuzzy con
 * bloqueo). Función PURA y testeable: no toca BD ni entorno.
 *
 * Pasos (docs/ARQUITECTURA_ENTITY_RESOLUTION.md §5.2):
 *   unaccent → minúsculas → quitar categorías por edad (sub-NN) → quitar
 *   puntuación → quitar tokens de sponsor → quitar género/categoría → quitar
 *   filial de una letra al final → colapsar espacios.
 *
 * El patrocinio NO es identidad: "Coinasa Liceo B" con sponsor "Coinasa"
 * normaliza a "liceo". Los tokens de sponsor se INYECTAN (vienen de la tabla
 * `sponsors`), así la función sigue siendo pura y la lista es dato, no código.
 *
 * Consciente y deliberado: sólo se quitan sponsor + género/categoría/filial.
 * NO se tocan palabras genéricas como "deportivo" o "club": unir "Deportivo
 * Liceo" con "Coinasa Liceo" es trabajo del fuzzy + HITL (fases 2-3), no de la
 * normalización determinista.
 */

/** Palabras de género/categoría que no forman parte de la identidad del club. */
const CATEGORY_WORDS = new Set([
  // ES
  'masculino', 'masculina', 'masc',
  'femenino', 'femenina', 'fem',
  // CAT / PT / IT (relevante para la expansión inter-fuente PT/IT)
  'masculi', 'femeni', 'feminino', 'maschile', 'femminile',
  'senior', 'seniors',
  'juvenil', 'juveniles', 'juv',
  'cadete', 'cadetes', 'cad',
  'infantil', 'infantiles', 'inf',
  'alevin', 'alevines',
  'benjamin', 'benjamines', 'prebenjamin',
]);

/** Filial de una sola letra (A/B/C/D) al final del nombre: "Liceo B" → "liceo". */
const FILIAL_SUFIX = /^[a-d]$/;

function stripDiacritics(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ñ/g, 'n');
}

function splitWords(s: string): string[] {
  return stripDiacritics(s.toLowerCase())
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

export function normalizeTeamName(
  raw: string,
  sponsorTokens: Iterable<string> = [],
): string {
  // Tokens de sponsor, cada palabra por separado ("Coinasa" → {coinasa}).
  const sponsors = new Set<string>();
  for (const s of sponsorTokens) {
    for (const w of splitWords(String(s))) sponsors.add(w);
  }

  // Categorías por edad tipo "sub-17"/"sub17": quitar ANTES de partir por
  // puntuación (si no, "sub-17" se rompería en "sub" + "17").
  const pre = stripDiacritics(raw.toLowerCase()).replace(/\bsub-?\d{1,2}\b/g, ' ');
  const tokens = pre.replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);

  // Quitar género/categoría (en cualquier posición) y tokens de sponsor.
  let kept = tokens.filter((t) => !CATEGORY_WORDS.has(t) && !sponsors.has(t));

  // Quitar la filial de una letra SOLO si es el último token y no es lo único.
  if (kept.length > 1 && FILIAL_SUFIX.test(kept[kept.length - 1]!)) {
    kept = kept.slice(0, -1);
  }

  // Nunca devolver vacío: si todo era ruido, cae a los tokens depurados.
  return (kept.length > 0 ? kept : tokens).join(' ');
}
