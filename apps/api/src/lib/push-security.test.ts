import { describe, it, expect, beforeAll } from 'vitest';
import {
  isAllowedPushEndpoint,
  makeUnsubscribeToken,
  verifyUnsubscribeToken,
  canDeleteSubscription,
} from './push-security.js';

// El token de ownership se firma con el secreto del state; lo fijamos para el test.
beforeAll(() => { process.env['AUTH_STATE_SECRET'] = 'test-secret-push'; });

describe('isAllowedPushEndpoint (#305) — anti-SSRF y anti-polucion', () => {
  it('acepta endpoints https de los push services conocidos', () => {
    expect(isAllowedPushEndpoint('https://fcm.googleapis.com/fcm/send/abc123')).toBe(true);
    expect(isAllowedPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/xyz')).toBe(true);
    expect(isAllowedPushEndpoint('https://web.push.apple.com/abc')).toBe(true);
    expect(isAllowedPushEndpoint('https://hnsvv.notify.windows.com/w/?token=x')).toBe(true);
  });

  it('rechaza http (exige https)', () => {
    expect(isAllowedPushEndpoint('http://fcm.googleapis.com/fcm/send/abc')).toBe(false);
  });

  it('rechaza hosts que no son push services', () => {
    expect(isAllowedPushEndpoint('https://evil.example.com/push')).toBe(false);
    // lookalike: el dominio real va delante pero el host acaba en otro sitio
    expect(isAllowedPushEndpoint('https://fcm.googleapis.com.evil.com/x')).toBe(false);
  });

  it('rechaza hosts internos / SSRF', () => {
    expect(isAllowedPushEndpoint('https://localhost/x')).toBe(false);
    expect(isAllowedPushEndpoint('https://127.0.0.1/x')).toBe(false);
    expect(isAllowedPushEndpoint('https://169.254.169.254/latest/meta-data')).toBe(false);
    expect(isAllowedPushEndpoint('https://10.0.0.5/x')).toBe(false);
    expect(isAllowedPushEndpoint('https://[::1]/x')).toBe(false);
    expect(isAllowedPushEndpoint('https://metadata.google.internal/x')).toBe(false);
  });

  it('rechaza credenciales embebidas y puertos no estándar', () => {
    expect(isAllowedPushEndpoint('https://user:pass@fcm.googleapis.com/x')).toBe(false);
    expect(isAllowedPushEndpoint('https://fcm.googleapis.com:8443/x')).toBe(false);
  });

  it('rechaza valores vacíos, no string o no parseables', () => {
    expect(isAllowedPushEndpoint(undefined)).toBe(false);
    expect(isAllowedPushEndpoint('')).toBe(false);
    expect(isAllowedPushEndpoint('no-es-una-url')).toBe(false);
    expect(isAllowedPushEndpoint({ endpoint: 'x' } as unknown)).toBe(false);
    expect(isAllowedPushEndpoint(`https://fcm.googleapis.com/${'a'.repeat(3000)}`)).toBe(false);
  });
});

describe('ownership del DELETE (#305)', () => {
  const owner = { deviceId: 'device-A', endpoint: 'https://fcm.googleapis.com/fcm/send/abc' };

  it('acepta cuando el deviceId coincide con el de la suscripción', () => {
    expect(canDeleteSubscription(owner, { deviceId: 'device-A' })).toBe(true);
  });

  it('rechaza cuando el deviceId no coincide', () => {
    expect(canDeleteSubscription(owner, { deviceId: 'device-B' })).toBe(false);
  });

  it('rechaza sin ninguna prueba de posesión', () => {
    expect(canDeleteSubscription(owner, {})).toBe(false);
  });

  it('acepta un token firmado válido (alternativa al deviceId)', () => {
    const token = makeUnsubscribeToken(owner.deviceId, owner.endpoint);
    expect(verifyUnsubscribeToken(token, owner.deviceId, owner.endpoint)).toBe(true);
    expect(canDeleteSubscription(owner, { token })).toBe(true);
  });

  it('rechaza un token inválido o de otra suscripción', () => {
    expect(verifyUnsubscribeToken('firmafalsa', owner.deviceId, owner.endpoint)).toBe(false);
    expect(
      canDeleteSubscription(owner, { token: makeUnsubscribeToken('otro-device', owner.endpoint) })
    ).toBe(false);
    expect(
      canDeleteSubscription(owner, { token: makeUnsubscribeToken(owner.deviceId, 'https://x/y') })
    ).toBe(false);
  });

  it('permite borrar filas legacy sin device_id asignado', () => {
    expect(canDeleteSubscription({ deviceId: 'unknown', endpoint: owner.endpoint }, {})).toBe(true);
  });
});
