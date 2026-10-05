/**
 * Abreviatura de respaldo (3 letras) para un equipo cuando la fuente NO publica
 * una. Las abreviaturas oficiales (RIV, PAS, NOIA…) son de la fuente y no se
 * derivan; esto es solo un fallback para que una lista móvil no muestre el
 * nombre completo cuando falta `short_name`.
 *
 * Toma la última palabra con contenido "de club" (normalmente la ciudad/entidad)
 * y sus 3 primeras letras, saltando siglas de club y sufijos de filial cortos.
 *
 *   "AMETLLER ORIGEN CP VILAFRANCA" → "VIL"
 *   "HC RAXOI"                      → "RAX"
 *   "CLUB PATIN ALCOBENDAS B"       → "ALC"
 */
const CLUB_TOKENS = new Set([
  'CP', 'HC', 'CH', 'CE', 'CA', 'CD', 'CF', 'CLUB', 'PATI', 'PATIN',
  'HOCKEY', 'HOQUEI', 'DEPORTIU', 'DEPORTIVO',
]);

function deaccent(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** Devuelve 3 letras o '' si no hay ninguna palabra con suficiente contenido. */
export function deriveShortName(name: string): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  for (let i = words.length - 1; i >= 0; i--) {
    const cand = words[i]!.toUpperCase();
    if (CLUB_TOKENS.has(cand)) continue;
    const clean = deaccent(cand).replace(/[^A-Za-z]/g, '');
    if (clean.length >= 3) return clean.slice(0, 3).toUpperCase();
  }
  return '';
}
