/**
 * Utilidades de formateo de nombres para la app móvil (paridad con web apps/web/src/lib/names.ts).
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

const FORCE_TITLE = new Set(['REY', 'SUR', 'SAN', 'VIC']);

function isDottedAcronym(word: string): boolean {
  return word.includes('.') && /^\p{L}(?:\.?\p{L})+\.?$/u.test(word);
}

function normalizeAcronym(word: string): string {
  return word.replace(/[^\p{L}\p{N}]/gu, '').toUpperCase();
}

function pushAcronym(out: string[], acronym: string): void {
  const previous = out[out.length - 1];
  if (acronym.length === 1 && previous && /^[A-Z]$/.test(previous)) {
    out[out.length - 1] = previous + acronym;
    return;
  }
  out.push(acronym);
}

/**
 * Normaliza nombres de clubes a formato amigable:
 * "IGUALADA RIGAT HC" → "Igualada Rigat HC"
 * "C.E. NOIA FREIXENET" → "CE Noia Freixenet"
 * "C. P. SAN CRISTOBAL" → "CP San Cristobal"
 */
export function clubName(name: string): string {
  if (!name) return '';
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

    if (!allUpper) {
      out.push(word);
      continue;
    }

    out.push(word.charAt(0).toUpperCase() + lower.slice(1));
  }

  return out.join(' ');
}

export function teamDisplayName(name: string | null | undefined, shortName?: string | null): string {
  if (name && name.trim()) return clubName(name);
  return (shortName ?? '').trim();
}

const SURNAME_PARTICLES = new Set([
  'de', 'del', 'della', 'di', 'da', 'das', 'dos', 'van', 'von', 'der', 'den', 'la', 'le', 'lo',
]);

export function playerDisplayName(firstName: string, lastName: string): string {
  const parts = (lastName ?? '').trim().split(/\s+/).filter(Boolean);
  let take = Math.min(1, parts.length);
  while (take < parts.length && SURNAME_PARTICLES.has(parts[take - 1]!.toLowerCase())) take++;
  const surname = parts.slice(0, take).join(' ');
  return toTitleCase(`${firstName ?? ''} ${surname}`.trim());
}

/** Desde el nombre crudo de la fuente: "ALABART GONZALEZ IGNACIO" → "Ignacio Alabart" */
export function playerNameFromRaw(raw: string): string {
  const parts = raw.replace(/\s+/g, ' ').trim().split(' ');
  if (parts.length === 1) return toTitleCase(parts[0]!);
  return toTitleCase(`${parts[parts.length - 1]} ${parts[0]}`);
}
