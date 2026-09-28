import { describe, it, expect, beforeAll } from 'vitest';
import { createHmac } from 'node:crypto';
import { signState, verifyState } from './auth-state.js';

// El secreto se lee del entorno; fijamos uno para el test.
beforeAll(() => { process.env['AUTH_STATE_SECRET'] = 'test-secret-para-hmac'; });

describe('signState / verifyState (CSRF de login, HMAC)', () => {
  const T0 = 1_700_000_000_000; // instante fijo para probar expiración sin esperar

  it('un state firmado se verifica y devuelve el payload con iat/exp', () => {
    const raw = signState({ d: 'device-123' }, T0);
    const st = verifyState(raw, T0);
    expect(st).toMatchObject({ d: 'device-123' });
    expect(st?.iat).toBe(Math.floor(T0 / 1000));
    expect(st?.exp).toBeGreaterThan(st?.iat ?? 0);
  });

  it('rechaza un state expirado (> TTL de 10 min)', () => {
    const raw = signState({ d: 'device-123' }, T0);
    // 10 min y 1 s después: ya no vale.
    expect(verifyState(raw, T0 + 10 * 60_000 + 1_000)).toBeNull();
  });

  it('acepta un state dentro del TTL', () => {
    const raw = signState({ d: 'device-123' }, T0);
    expect(verifyState(raw, T0 + 9 * 60_000)).toMatchObject({ d: 'device-123' });
  });

  it('rechaza un payload sin exp (state antiguo/manipulado)', () => {
    const body = Buffer.from(JSON.stringify({ d: 'device-123' })).toString('base64url');
    const sig = createHmac('sha256', 'test-secret-para-hmac').update(body).digest('base64url');
    expect(verifyState(`${body}.${sig}`, T0)).toBeNull();
  });

  it('rechaza un state con la firma manipulada', () => {
    const raw = signState({ d: 'device-123' });
    const [body] = raw.split('.');
    expect(verifyState(`${body}.firmafalsa`)).toBeNull();
  });

  it('rechaza si se altera el body (la firma deja de cuadrar)', () => {
    const raw = signState({ d: 'device-123' });
    const [, sig] = raw.split('.');
    const otroBody = Buffer.from(JSON.stringify({ d: 'atacante' })).toString('base64url');
    expect(verifyState(`${otroBody}.${sig}`)).toBeNull();
  });

  it('rechaza formatos inválidos (vacío, sin punto, undefined)', () => {
    expect(verifyState(undefined)).toBeNull();
    expect(verifyState('')).toBeNull();
    expect(verifyState('sinpunto')).toBeNull();
  });

  it('no valida un state firmado con OTRO secreto', () => {
    const raw = signState({ d: 'x' });
    process.env['AUTH_STATE_SECRET'] = 'secreto-distinto';
    const res = verifyState(raw);
    process.env['AUTH_STATE_SECRET'] = 'test-secret-para-hmac';
    expect(res).toBeNull();
  });
});
