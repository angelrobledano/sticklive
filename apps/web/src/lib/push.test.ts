import { describe, it, expect } from 'vitest';
import { shouldOfferPushActivation, pushOfferMode, type PushActivationContext } from './push';

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

/**
 * 04/11/2026: 0 `push_subscribed` en 60 días. En iPhone sin instalar la oferta
 * desaparecía sin explicar que hace falta instalar la app.
 */
describe('pushOfferMode', () => {
  const ctx = (o: Partial<PushActivationContext> = {}): PushActivationContext => ({
    supported: true, permission: 'default', vapidMissing: false, ios: false, standalone: false, ...o,
  });
  it('navegador compatible sin decisión: activar', () => {
    expect(pushOfferMode(ctx())).toBe('activate');
  });
  it('iPhone sin instalar: explicar que hay que instalar (aunque no haya PushManager)', () => {
    expect(pushOfferMode(ctx({ ios: true, standalone: false, supported: false, permission: 'unsupported' }))).toBe('install_ios');
  });
  it('iPhone instalado: activar', () => {
    expect(pushOfferMode(ctx({ ios: true, standalone: true }))).toBe('activate');
  });
  it('ya concedido, denegado o sin VAPID: nada', () => {
    expect(pushOfferMode(ctx({ permission: 'granted' }))).toBe('none');
    expect(pushOfferMode(ctx({ permission: 'denied' }))).toBe('none');
    expect(pushOfferMode(ctx({ vapidMissing: true }))).toBe('none');
    expect(pushOfferMode(ctx({ ios: true, vapidMissing: true }))).toBe('none');
  });
});
