import { describe, it, expect } from 'vitest';
import { shouldOfferPushActivation, type PushActivationContext } from './push';

const base: PushActivationContext = {
  supported: true,
  permission: 'default',
  vapidMissing: false,
  ios: false,
  standalone: true,
};

describe('shouldOfferPushActivation — decisión de ofrecer "Activar avisos"', () => {
  it('ofrece activar cuando hay soporte y el permiso está sin decidir', () => {
    expect(shouldOfferPushActivation(base)).toBe(true);
  });

  it('no ofrece si el navegador no soporta push o falta la clave VAPID', () => {
    expect(shouldOfferPushActivation({ ...base, supported: false })).toBe(false);
    expect(shouldOfferPushActivation({ ...base, vapidMissing: true })).toBe(false);
  });

  it('no vuelve a pedir si ya hay permiso concedido o denegado', () => {
    expect(shouldOfferPushActivation({ ...base, permission: 'granted' })).toBe(false);
    expect(shouldOfferPushActivation({ ...base, permission: 'denied' })).toBe(false);
    expect(shouldOfferPushActivation({ ...base, permission: 'unsupported' })).toBe(false);
  });

  it('en iOS solo lo ofrece si la app está instalada (standalone)', () => {
    expect(shouldOfferPushActivation({ ...base, ios: true, standalone: false })).toBe(false);
    expect(shouldOfferPushActivation({ ...base, ios: true, standalone: true })).toBe(true);
  });
});
