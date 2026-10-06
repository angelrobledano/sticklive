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

/**
 * #252: la página /premium/success recibía `session_id` sin validar. Se valida
 * el formato ANTES de llamar a Stripe: `cs_...`, solo caracteres seguros y una
 * longitud acotada. Evita reenviar al proveedor cualquier `id` arbitrario.
 */
export function isCheckoutSessionId(value: unknown): value is string {
  return typeof value === 'string' && /^cs_[A-Za-z0-9_]{8,200}$/.test(value);
}

/**
 * #252: mapea el estado de una Checkout Session de Stripe a entitlement.
 * Solo un pago confirmado concede premium (`payment_status === 'paid'`).
 * `no_payment_required` + `complete` cubre un descuento del 100% / importe 0.
 * Pura y testeable: no llama a Stripe.
 */
export function isPaidCheckoutSession(
  session: { payment_status?: string | null; status?: string | null } | null | undefined
): boolean {
  if (!session) return false;
  if (session.payment_status === 'paid') return true;
  return session.payment_status === 'no_payment_required' && session.status === 'complete';
}

/** Campos de usuario relevantes para el guard (subconjunto de users). */
export interface PremiumFields {
  premiumUntil?: string | Date | null;
  premiumLifetime?: boolean | null;
}

/**
 * Guard ÚNICO de premium para todas las superficies (web y app): lifetime
 * (compra única Play) o suscripción vigente. `isPremiumActive` sigue siendo
 * la regla de caducidad; esto solo añade el OR del lifetime (spec §4).
 */
export function isUserPremium(
  user: PremiumFields | null | undefined,
  now: Date = new Date()
): boolean {
  if (!user) return false;
  if (user.premiumLifetime) return true;
  return isPremiumActive(user.premiumUntil, now);
}
