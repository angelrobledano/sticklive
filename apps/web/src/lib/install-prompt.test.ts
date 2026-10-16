import { describe, it, expect } from 'vitest';
import { shouldShowInstallBanner, DISMISS_DAYS, MIN_PAGE_VIEWS, type InstallBannerInput } from './install-prompt';

/**
 * Aviso para instalar la PWA: solo en móvil, cuando se puede instalar de
 * verdad, sin pisar el aviso de cookies, tras un mínimo de uso y respetando
 * un «Ahora no» durante unos días.
 */
const NOW = Date.parse('2026-10-16T18:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

const base: InstallBannerInput = {
  platform: 'android',
  standalone: false,
  hasNativePrompt: true,
  consent: 'granted',
  dismissedAt: null,
  pageViews: MIN_PAGE_VIEWS,
  now: NOW,
};

describe('shouldShowInstallBanner', () => {
  it('Android con el diálogo nativo disponible y algo de uso: sí', () => {
    expect(shouldShowInstallBanner(base)).toBe(true);
  });

  it('iPhone: sí aunque no haya diálogo nativo (se enseñan los pasos)', () => {
    expect(shouldShowInstallBanner({ ...base, platform: 'ios', hasNativePrompt: false })).toBe(true);
  });

  it('Android sin diálogo nativo (navegador que no instala): no', () => {
    expect(shouldShowInstallBanner({ ...base, hasNativePrompt: false })).toBe(false);
  });

  it('escritorio: no', () => {
    expect(shouldShowInstallBanner({ ...base, platform: 'desktop' })).toBe(false);
  });

  it('ya instalada (standalone): no', () => {
    expect(shouldShowInstallBanner({ ...base, standalone: true })).toBe(false);
  });

  it('con el aviso de cookies sin contestar: espera (no se apilan)', () => {
    expect(shouldShowInstallBanner({ ...base, consent: 'pending' })).toBe(false);
  });

  it('rechazar la analítica no impide ofrecer la instalación', () => {
    expect(shouldShowInstallBanner({ ...base, consent: 'denied' })).toBe(true);
  });

  it('nada más entrar (menos páginas vistas que el mínimo): todavía no', () => {
    expect(shouldShowInstallBanner({ ...base, pageViews: MIN_PAGE_VIEWS - 1 })).toBe(false);
  });

  it('«Ahora no» reciente: no; pasados los días de espera: vuelve', () => {
    expect(shouldShowInstallBanner({ ...base, dismissedAt: NOW - 2 * DAY })).toBe(false);
    expect(shouldShowInstallBanner({ ...base, dismissedAt: NOW - (DISMISS_DAYS + 1) * DAY })).toBe(true);
  });
});
