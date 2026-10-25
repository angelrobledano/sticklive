/**
 * País preferido de la home (plan 2026-10-25, iteración 4). Puro.
 *
 * La sugerencia inicial sale de la REGIÓN del navegador (`pt-PT` → PT), nunca
 * del idioma a secas: hablar portugués no significa seguir la liga portuguesa
 * (`pt-BR`), ni el español la española (`es-AR`). Solo se sugieren países con
 * competiciones. Es una sugerencia: el usuario lo cambia cuando quiera.
 */
export function isCountryCode(v: unknown): v is string {
  return typeof v === 'string' && /^[A-Z]{2}$/.test(v);
}

export function suggestCountry(languages: readonly string[], available: readonly string[]): string | null {
  const ok = new Set(available);
  for (const tag of languages) {
    const region = /^[a-z]{2,3}-([A-Za-z]{2})\b/.exec(tag)?.[1]?.toUpperCase();
    if (region && ok.has(region)) return region;
  }
  return null;
}
