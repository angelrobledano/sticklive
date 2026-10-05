import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearSession,
  loadSession,
  parseAuthError,
  parseAuthRedirect,
  saveSession,
} from './session';

// SecureStore es código NATIVO: en vitest (node) no existe y hay que mockearlo.
// El store vive en vi.hoisted para que el factory del mock lo vea ya
// inicializado cuando se importe './session' (patrón del repo:
// apps/api/src/lib/mailer.test.ts).
const { store } = vi.hoisted(() => ({ store: new Map<string, string>() }));
vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async (k: string) => store.get(k) ?? null),
  setItemAsync: vi.fn(async (k: string, v: string) => void store.set(k, v)),
  deleteItemAsync: vi.fn(async (k: string) => void store.delete(k)),
}));

describe('parseAuthRedirect', () => {
  it('extrae code y email del redirect del callback', () => {
    const url = 'sticklive://auth/callback?code=abc123&email=a%40b.com';
    expect(parseAuthRedirect(url)).toEqual({ code: 'abc123', email: 'a@b.com' });
  });

  it('acepta un redirect sin email (el API puede no devolverlo)', () => {
    expect(parseAuthRedirect('sticklive://auth/callback?code=solo')).toEqual({
      code: 'solo',
      email: null,
    });
  });

  it('rechaza un redirect con error (el motivo lo reporta parseAuthError)', () => {
    expect(parseAuthRedirect('sticklive://auth/callback?error=google_denied')).toBeNull();
  });

  it('rechaza un redirect sin code', () => {
    expect(parseAuthRedirect('sticklive://auth/callback')).toBeNull();
  });

  it('rechaza URLs ajenas al callback', () => {
    expect(parseAuthRedirect('https://otra-cosa?code=x')).toBeNull();
  });
});

describe('parseAuthError', () => {
  it('extrae el motivo que el API redirige por el scheme (?error=…)', () => {
    expect(parseAuthError('sticklive://auth/callback?error=google_denied')).toBe('google_denied');
  });

  it('devuelve null si no hay error o la URL no es del callback', () => {
    expect(parseAuthError('sticklive://auth/callback?code=ok')).toBeNull();
    expect(parseAuthError('https://otra-cosa?error=google_denied')).toBeNull();
  });
});

describe('sesión', () => {
  beforeEach(() => store.clear());

  it('guarda, carga y borra redondeando con SecureStore', async () => {
    await saveSession({ token: 'tok', email: 'a@b.com' });
    expect(await loadSession()).toEqual({ token: 'tok', email: 'a@b.com' });

    await clearSession();
    expect(await loadSession()).toBeNull();
  });

  it('una sesión sin email guardado carga con email null', async () => {
    await saveSession({ token: 'tok', email: null });
    expect(await loadSession()).toEqual({ token: 'tok', email: null });
  });
});
