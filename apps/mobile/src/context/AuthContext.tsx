import * as WebBrowser from 'expo-web-browser';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { API_URL, apiFetch, ApiError } from '@/src/lib/api/client';
import { capture, identifyUser, resetIdentity } from '@/src/lib/analytics';
import { getDeviceId } from '@/src/lib/device';
import {
  clearSession,
  loadSession,
  parseAuthError,
  parseAuthRedirect,
  saveSession,
  type Session,
} from '@/src/lib/session';
import { mergeLocalOnLogin } from '@/src/hooks/favorites';

/**
 * Sobre `WebBrowser.maybeCompleteAuthSession()`: NO se llama. Es método SOLO
 * WEB (doc expo-web-browser v57: en Android/iOS devuelve "Not supported on
 * this platform"); con openAuthSessionAsync + custom scheme la promise nativa
 * resuelve directamente con `{ type: 'success', url }` cuando el navegador
 * redirige a sticklive://. Con Expo Router los deep links se manejan solos, y
 * añadir Linking.addEventListener es redundante y puede tener efectos
 * secundarios (misma doc).
 */

interface AuthCtx {
  session: Session | null;
  /** true cuando la sesión persistida ya se ha cargado (evita parpadeos). */
  ready: boolean;
  /**
   * Motivo crudo del último fallo de login sin resolver (p. ej.
   * 'google_denied' del callback, o el code de un ApiError del canje). La
   * pantalla lo traduce a mensaje; null si el último intento fue limpio o
   * exitoso. Nunca se traga un fallo en silencio (regla del repo).
   */
  lastAuthError: string | null;
  setLastAuthError: (error: string | null) => void;
  signInWithGoogle: () => Promise<void>;
  exchangeAuthCode: (code: string, emailHint?: string | null) => Promise<Session | null>;
  requestMagicLink: (email: string) => Promise<{ ok: boolean; error?: string; devLink?: string }>;
  signInWithMagicLinkToken: (token: string) => Promise<boolean>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [lastAuthError, setLastAuthError] = useState<string | null>(null);
  const pendingExchangeRef = useRef<Map<string, Promise<Session | null>>>(new Map());

  useEffect(() => {
    // Fail-closed: si SecureStore es ilegible (storage corrupto, permiso
    // denegado…), desloguear es lo correcto — no hay sesión fiable que
    // mostrar y un usuario sin sesión ve el botón de login. Nunca en silencio.
    loadSession()
      .then(setSession)
      .catch((err) => {
        console.error('[auth] no se pudo leer la sesión de SecureStore', err);
        setSession(null);
      })
      .finally(() => setReady(true));
  }, []);

  /**
   * Canje de código single-use contra POST /auth/exchange con deduplicación
   * atómica en vuelo: si WebBrowser.openAuthSessionAsync y el deep link del
   * sistema operativo (sticklive://auth/callback) intentan canjear el mismo
   * código a la vez, el segundo reutiliza la Promise del primero sin hacer un
   * segundo POST (que fallaría con 400 invalid_code porque el código ya se usó).
   */
  const exchangeAuthCode = useCallback(async (code: string, emailHint?: string | null): Promise<Session | null> => {
    const existing = pendingExchangeRef.current.get(code);
    if (existing) {
      return existing;
    }

    const exchangePromise = (async () => {
      try {
        const deviceId = await getDeviceId();
        const data = await apiFetch<{ session: string; email: string | null }>('/auth/exchange', {
          method: 'POST',
          body: { code, deviceId },
        });
        const s: Session = { token: data.session, email: data.email ?? emailHint ?? null };
        await saveSession(s);
        if (s.email) identifyUser(s.email);
        capture('login_completed', { method: 'google' });
        try {
          await mergeLocalOnLogin(s.token);
        } catch (mergeErr) {
          console.error('[auth] no se pudieron fusionar los favoritos locales con la cuenta', mergeErr);
        }
        setSession(s);
        setLastAuthError(null);
        return s;
      } catch (err) {
        const reason = err instanceof ApiError ? err.code : 'unknown';
        setLastAuthError(reason);
        return null;
      }
    })();

    pendingExchangeRef.current.set(code, exchangePromise);
    return exchangePromise;
  }, []);

  const signInWithGoogle = useCallback(async () => {
    setLastAuthError(null);
    try {
      const deviceId = await getDeviceId();
      // Navegador del sistema (Chrome Custom Tabs / ASWebAuthenticationSession):
      // la promise resuelve al volver por el scheme sticklive://auth/callback.
      const result = await WebBrowser.openAuthSessionAsync(
        `${API_URL}/auth/google?client=app&device=${encodeURIComponent(deviceId)}`,
        'sticklive://auth/callback',
      );
      if (result.type !== 'success') return; // cancel/dismiss: el usuario cerró el navegador; no es un fallo

      // El callback del API (fail consciente del cliente) puede reportar el
      // fallo por el scheme: ?error=<reason>. Se expone, jamás se ignora.
      const reason = parseAuthError(result.url);
      if (reason) {
        setLastAuthError(reason);
        return;
      }
      const parsed = parseAuthRedirect(result.url);
      if (!parsed) {
        // Redirect inesperado (ni code ni error): tampoco en silencio.
        setLastAuthError('unexpected_redirect');
        return;
      }
      // Canje seguro y deduplicado con el intent de Android
      await exchangeAuthCode(parsed.code, parsed.email);
    } catch (err) {
      setLastAuthError(err instanceof ApiError ? err.code : 'unknown');
    }
  }, [exchangeAuthCode]);

  const requestMagicLink = useCallback(async (email: string) => {
    setLastAuthError(null);
    try {
      const res = await apiFetch<{ sent: boolean; devLink?: string }>('/auth/magic-link', {
        method: 'POST',
        body: { email },
      });
      return { ok: res.sent, devLink: res.devLink };
    } catch (err) {
      const code = err instanceof ApiError ? err.code : 'unknown';
      setLastAuthError(code);
      return { ok: false, error: code };
    }
  }, []);

  const signInWithMagicLinkToken = useCallback(async (token: string) => {
    setLastAuthError(null);
    try {
      const deviceId = await getDeviceId();
      const res = await apiFetch<{ session: string; email: string }>('/auth/verify', {
        method: 'POST',
        body: { token, deviceId },
      });
      const s: Session = { token: res.session, email: res.email };
      await saveSession(s);
      if (s.email) identifyUser(s.email);
      capture('login_completed', { method: 'magic_link' });
      try {
        await mergeLocalOnLogin(s.token);
      } catch (mergeErr) {
        console.error('[auth] no se pudieron fusionar los favoritos locales con la cuenta', mergeErr);
      }
      setSession(s);
      return true;
    } catch (err) {
      const code = err instanceof ApiError ? err.code : 'unknown';
      setLastAuthError(code);
      return false;
    }
  }, []);

  const signOut = useCallback(async () => {
    setLastAuthError(null);
    try {
      await clearSession();
    } catch (err) {
      // Fallo explícito, no silencioso. No hay clave i18n de "logout fallido"
      // (auth.* habla del login) y reusar lastAuthError mostraría un mensaje
      // de Google sin relación con lo ocurrido: el canal mínimo coherente con
      // el repo es la consola del dispositivo (Sentry la capturará en 5.1).
      console.error('[auth] no se pudo borrar la sesión de SecureStore', err);
    } finally {
      // Hagas lo que haga clearSession, la UI desloguea: seguir mostrando una
      // "sesión" con un botón de salida muerto es peor. Si el token sobrevivió
      // en disco, reaparecerá al relanzar (loadSession es la fuente de verdad).
      // Analítica (review 5.1): también muere el email persistido en PostHog —
      // si el SDK conservara el distinct del login A, un login B posterior
      // enviaría $identify con A como anon y fusionaría ambas personas.
      // resetIdentity nunca lanza (try/catch interno).
      resetIdentity();
      setSession(null);
    }
  }, []);

  const value = useMemo(
    () => ({
      session,
      ready,
      lastAuthError,
      setLastAuthError,
      signInWithGoogle,
      exchangeAuthCode,
      requestMagicLink,
      signInWithMagicLinkToken,
      signOut,
    }),
    [
      session,
      ready,
      lastAuthError,
      setLastAuthError,
      signInWithGoogle,
      exchangeAuthCode,
      requestMagicLink,
      signInWithMagicLinkToken,
      signOut,
    ],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): AuthCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useSession fuera de AuthProvider');
  return ctx;
}
