import { describe, it, expect } from 'vitest';
import { isPremiumActive, isCheckoutSessionId, isPaidCheckoutSession } from './premium.js';

describe('isPremiumActive', () => {
  const now = new Date('2026-06-16T12:00:00Z');

  it('null/undefined → no premium', () => {
    expect(isPremiumActive(null, now)).toBe(false);
    expect(isPremiumActive(undefined, now)).toBe(false);
  });

  it('fecha futura → premium activo', () => {
    expect(isPremiumActive('2027-06-16T12:00:00Z', now)).toBe(true);
  });

  it('fecha pasada → premium caducado (lo que antes no se reflejaba)', () => {
    expect(isPremiumActive('2026-06-15T12:00:00Z', now)).toBe(false);
  });

  it('acepta Date además de string', () => {
    expect(isPremiumActive(new Date('2027-01-01T00:00:00Z'), now)).toBe(true);
  });

  it('fecha inválida → no premium', () => {
    expect(isPremiumActive('basura', now)).toBe(false);
  });
});

/**
 * #252: la página /premium/success recibía `session_id` sin validar y concedía
 * premium solo por llegar a la URL. El endpoint de sesión valida primero el id
 * (antes de llamar a Stripe) y mapea el estado de la sesión a entitlement.
 */
describe('isCheckoutSessionId', () => {
  it('acepta ids reales de Checkout Session', () => {
    expect(isCheckoutSessionId('cs_test_a1B2c3D4e5F6g7H8')).toBe(true);
    expect(isCheckoutSessionId('cs_live_12345678')).toBe(true);
  });

  it('rechaza vacío, no-string y valores de otros recursos', () => {
    expect(isCheckoutSessionId('')).toBe(false);
    expect(isCheckoutSessionId(null)).toBe(false);
    expect(isCheckoutSessionId(undefined)).toBe(false);
    expect(isCheckoutSessionId(42)).toBe(false);
    expect(isCheckoutSessionId('cus_12345678')).toBe(false);
    expect(isCheckoutSessionId('https://checkout.stripe.com/c/pay/cs_test_12345678')).toBe(false);
  });

  it('rechaza prefijo correcto pero longitud/caracteres inválidos', () => {
    expect(isCheckoutSessionId('cs_')).toBe(false);
    expect(isCheckoutSessionId('cs_short')).toBe(false);
    expect(isCheckoutSessionId('cs_test_a1b2 c3d4')).toBe(false);
    expect(isCheckoutSessionId('cs_test_a1b2/c3d4')).toBe(false);
    expect(isCheckoutSessionId('cs_test_a1b2\nc3d4')).toBe(false);
    expect(isCheckoutSessionId(`cs_${'a'.repeat(201)}`)).toBe(false);
  });
});

describe('isPaidCheckoutSession', () => {
  it('sin sesión → no concede premium', () => {
    expect(isPaidCheckoutSession(null)).toBe(false);
    expect(isPaidCheckoutSession(undefined)).toBe(false);
    expect(isPaidCheckoutSession({})).toBe(false);
  });

  it('payment_status=paid → concede premium', () => {
    expect(isPaidCheckoutSession({ payment_status: 'paid', status: 'complete' })).toBe(true);
    expect(isPaidCheckoutSession({ payment_status: 'paid' })).toBe(true);
  });

  it('pago pendiente o fallido → NO concede premium', () => {
    expect(isPaidCheckoutSession({ payment_status: 'unpaid', status: 'open' })).toBe(false);
    // Pago asíncrono aún no confirmado: la sesión está completa pero no cobrada.
    expect(isPaidCheckoutSession({ payment_status: 'unpaid', status: 'complete' })).toBe(false);
  });

  it('no_payment_required solo si la sesión está completa', () => {
    expect(isPaidCheckoutSession({ payment_status: 'no_payment_required', status: 'complete' })).toBe(true);
    expect(isPaidCheckoutSession({ payment_status: 'no_payment_required', status: 'open' })).toBe(false);
  });
});
