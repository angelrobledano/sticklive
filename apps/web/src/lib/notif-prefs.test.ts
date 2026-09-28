import { describe, it, expect } from 'vitest';
import { resolvePreset, isPresetEnabled, presetFromToggle, type NotificationPreset } from './notif-prefs';

/**
 * #266: el switch de notificaciones por entidad no silenciaba cuando la entidad
 * tenía un preset explícito (el preset ganaba sobre la lista antigua de
 * "desactivados"). Esta es la decisión PURA: lo explícito manda y solo 'silent'
 * apaga el aviso.
 */
describe('resolvePreset — preset efectivo de una entidad', () => {
  it('sin preset explícito usa la lista antigua (desactivado → silent)', () => {
    expect(resolvePreset(undefined, false)).toBe('complete');
    expect(resolvePreset(undefined, true)).toBe('silent');
  });

  it('un preset explícito gana SIEMPRE sobre la lista antigua', () => {
    // El caso del bug: la lista dice "activado" (legacyDisabled=false) pero el
    // preset explícito es 'silent' → debe silenciar.
    expect(resolvePreset('silent', false)).toBe('silent');
    // Y al revés: aunque estuviera en la lista antigua, un 'complete' explícito manda.
    expect(resolvePreset('complete', true)).toBe('complete');
  });

  it('acepta el resto de presets explícitos', () => {
    expect(resolvePreset('key_events', false)).toBe('key_events');
    expect(resolvePreset('results', true)).toBe('results');
  });
});

describe('isPresetEnabled — estado del switch', () => {
  it('solo "silent" apaga el switch', () => {
    const enabled: NotificationPreset[] = ['complete', 'key_events', 'results'];
    for (const p of enabled) expect(isPresetEnabled(p)).toBe(true);
    expect(isPresetEnabled('silent')).toBe(false);
  });
});

describe('presetFromToggle — preset que aplica el switch', () => {
  it('activar → complete, desactivar → silent', () => {
    expect(presetFromToggle(true)).toBe('complete');
    expect(presetFromToggle(false)).toBe('silent');
  });
});
