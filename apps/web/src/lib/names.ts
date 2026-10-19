/**
 * Sistema global de formato de nombres (equipos y jugadores).
 * Regla transversal de la app:
 *  · Clubes: nombre oficial en Sentence case en escritorio; corto/siglas en móvil.
 *  · Jugadores: SIEMPRE "Nombre Apellido" en Sentence case (primer apellido).
 */

/**
 * Nombre de competición en el idioma activo.
 *
 * Elige `nameI18n[locale]`, cae a `nameI18n.es` y por último al `name` plano.
 * Hoy todas las competiciones son españolas y `nameI18n` es `{es: name}` (o
 * null), así que devuelve el español — pero deja el mecanismo listo para cuando
 * entre una competición con traducción. Ver migración 038.
 *
 * No aplica `clubName()` aquí: eso es cosa de quien lo pinte (algunos sitios sí
 * lo formatean, otros lo quieren crudo).
 */
export function competitionName(
  name: string,
  nameI18n: Record<string, string> | null | undefined,
  locale: string,
): string {
  return nameI18n?.[locale] ?? nameI18n?.['es'] ?? name;
}

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
// la heurística de "≤3 letras = sigla" no las deje gritadas (REY, SUR, SAN…).
const FORCE_TITLE = new Set(['REY', 'SUR', 'SAN']);

/** "C.E." / "C.E" / "S.A." → sigla con puntos. */
function isDottedAcronym(word: string): boolean {
  return word.includes('.') && /^\p{L}(?:\.?\p{L})+\.?$/u.test(word);
}

/** Quita puntos/comas y normaliza a mayúsculas, conservando dígitos (U19). */
function normalizeAcronym(word: string): string {
  return word.replace(/[^\p{L}\p{N}]/gu, '').toUpperCase();
}

/** Une siglas de una sola letra consecutivas: "C." + "P." → "CP". */
function pushAcronym(out: string[], acronym: string): void {
  const previous = out[out.length - 1];
  if (acronym.length === 1 && previous && /^[A-Z]$/.test(previous)) {
    out[out.length - 1] = previous + acronym;
    return;
  }
  out.push(acronym);
}

/**
 * "IGUALADA RIGAT HC" → "Igualada Rigat HC"; "COPA DEL REY" → "Copa del Rey";
 * "C.E. NOIA FREIXENET" → "CE Noia Freixenet"; "C. P. SAN CRISTOBAL" → "CP San Cristobal".
 *
 * Conserva siglas reales (≤3 letras, con o sin puntos) y baja conectores. Si una
 * palabra ya trae minúsculas (nombre curado como "Barça" o "CE Noia Freixenet")
 * se respeta tal cual: la normalización no debe re-mayusculizar lo editado a mano.
 */
export function clubName(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const out: string[] = [];

  for (const [i, word] of words.entries()) {
    const lower = word.toLowerCase();
    if (i > 0 && CONNECTORS.has(lower)) {
      out.push(lower);
      continue;
    }

    if (isDottedAcronym(word)) {
      pushAcronym(out, normalizeAcronym(word));
      continue;
    }

    const letters = word.replace(/[^\p{L}\p{N}]/gu, '');
    const allUpper = word === word.toUpperCase();
    const isAcronym =
      allUpper &&
      letters.length > 0 &&
      letters.length <= 3 &&
      !FORCE_TITLE.has(letters.toUpperCase());

    if (isAcronym) {
      pushAcronym(out, normalizeAcronym(word));
      continue;
    }

    // Nombre ya curado (tiene minúsculas): no tocar su casing.
    if (!allUpper) {
      out.push(word);
      continue;
    }

    out.push(word.charAt(0).toUpperCase() + lower.slice(1));
  }

  return out.join(' ');
}

/**
 * Nombre de equipo para títulos/meta (#338): el nombre COMPLETO normalizado.
 *
 * `clubName()` aplicado a un shortName de 4 letras lo degrada a Title-Case
 * ("CPAH" → "Cpah"), así que los títulos/SEO no deben preferir las siglas. Solo
 * se cae al shortName (crudo, sin mutar) si no hay nombre completo.
 */
export function teamTitleName(
  name: string | null | undefined,
  shortName: string | null | undefined,
): string {
  const full = name?.trim();
  if (full) return clubName(full);
  return (shortName ?? '').trim();
}

/**
 * Nombre + sección sin duplicar lo que ya esté en el nombre curado (F3-4).
 * "España Femenina" + "Femenina · Sub-19" → "España Femenina (Sub-19)".
 */
export function teamQualifiedName(name: string, section: string | null | undefined): string {
  const parts = (section ?? '')
    .split(' · ')
    .map((part) => part.trim())
    .filter(Boolean);
  const lowerName = name.toLowerCase();
  const missing = parts.filter((part) => !lowerName.includes(part.toLowerCase()));
  return missing.length > 0 ? `${name} (${missing.join(' · ')})` : name;
}

/** Desde first/last de la API: "FERRAN" + "FONT SÁNCHEZ" → "Ferran Font" */
// Partículas que forman parte del apellido compuesto ("DI BENEDETTO",
// "DE LA CRUZ", "VAN DER BERG"). No son apellidos por sí solas.
const SURNAME_PARTICLES = new Set([
  'de', 'del', 'della', 'di', 'da', 'das', 'dos', 'van', 'von', 'der', 'den', 'la', 'le', 'lo',
]);

/**
 * Desde first/last de la API: "FERRAN" + "FONT SÁNCHEZ" → "Ferran Font";
 * "CARLO" + "DI BENEDETTO" → "Carlos Di Benedetto". Usa el primer apellido,
 * pero conserva las partículas que lo convierten en apellido compuesto.
 */
export function playerDisplayName(firstName: string, lastName: string): string {
  const parts = lastName.trim().split(/\s+/).filter(Boolean);
  let take = Math.min(1, parts.length);
  while (take < parts.length && SURNAME_PARTICLES.has(parts[take - 1]!.toLowerCase())) take++;
  const surname = parts.slice(0, take).join(' ');
  return toTitleCase(`${firstName} ${surname}`.trim());
}

/** Desde el nombre crudo de la fuente: "ALABART GONZALEZ IGNACIO" → "Ignacio Alabart" */
export function playerNameFromRaw(raw: string): string {
  const parts = raw.replace(/\s+/g, ' ').trim().split(' ');
  if (parts.length === 1) return toTitleCase(parts[0]!);
  return toTitleCase(`${parts[parts.length - 1]} ${parts[0]}`);
}
