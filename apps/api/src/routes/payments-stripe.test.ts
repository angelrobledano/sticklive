import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';

// `@sports/db` exige DATABASE_URL al importarse. Fijamos una de mentira: estos
// tests solo ejercitan la validación temprana de la ruta (no tocan ni Stripe ni
// la BD), así que no necesitamos Postgres.
process.env['DATABASE_URL'] ??= 'postgres://localhost:5432/test';

const { stripeRouter } = await import('./payments-stripe.js');

const app = new Hono();
app.route('/payments/stripe', stripeRouter);

/**
 * #252: el endpoint de verificación de sesión debe rechazar ids con formato
 * inválido ANTES de llamar a Stripe. Así un `session_id` arbitrario de la URL
 * nunca llega al proveedor ni puede conceder entitlement.
 */
describe('GET /payments/stripe/session/:id — validación', () => {
  it('rechaza un id sin formato de Checkout Session con 400', async () => {
    const res = await app.request('/payments/stripe/session/no-es-una-sesion');
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid_session_id' });
  });

  it('rechaza un id con prefijo correcto pero demasiado corto', async () => {
    const res = await app.request('/payments/stripe/session/cs_short');
    expect(res.status).toBe(400);
  });
});

/**
 * #251: el restore exige deviceId + email bien formados ANTES de tocar
 * Stripe/BD — un parámetro ausente o corrupto nunca debe llegar al proveedor.
 */
describe('POST /payments/stripe/restore — validación temprana', () => {
  it('rechaza sin deviceId', async () => {
    const res = await app.request('/payments/stripe/restore', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'a@b.es' }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'missing_device_id' });
  });

  it('rechaza sin email', async () => {
    const res = await app.request('/payments/stripe/restore', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deviceId: 'dev-1' }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'missing_email' });
  });

  it('rechaza un email mal formado', async () => {
    const res = await app.request('/payments/stripe/restore', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deviceId: 'dev-1', email: 'no-es-un-email' }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'missing_email' });
  });
});
