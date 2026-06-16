/**
 * Estado premium AUTORITATIVO (auditoría S9): premium activo ⇔ premium_until
 * está en el futuro. NO se usa el flag is_premium, que nunca se revierte.
 * Pura y testeable.
 */
export function isPremiumActive(
  premiumUntil: string | Date | null | undefined,
  now: Date = new Date()
): boolean {
  if (!premiumUntil) return false;
  const t = premiumUntil instanceof Date ? premiumUntil.getTime() : new Date(premiumUntil).getTime();
  return Number.isFinite(t) && t > now.getTime();
}
