import { describe, it, expect, beforeAll } from 'vitest';
import { signState, verifyState } from './auth-state.js';

// El secreto se lee del entorno; fijamos uno para el test.
beforeAll(() => { process.env['AUTH_STATE_SECRET'] = 'test-secret-para-hmac'; });

describe('signState / verifyState (CSRF de login, HMAC)', () => {
  it('un state firmado se verifica y devuelve el payload', () => {
    const raw = signState({ d: 'device-123' });
    expect(verifyState(raw)).toEqual({ d: 'device-123' });
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
