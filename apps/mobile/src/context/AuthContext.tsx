import * as WebBrowser from 'expo-web-browser';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { API_URL, apiFetch, ApiError } from '@/src/lib/api/client';
import { getDeviceId } from '@/src/lib/device';
import {
  clearSession,
  loadSession,
  parseAuthError,
  parseAuthRedirect,
  saveSession,
  type Session,
} from '@/src/lib/session';

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
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [lastAuthError, setLastAuthError] = useState<string | null>(null);

  useEffect(() => {
    loadSession()
      .then(setSession)
      .finally(() => setReady(true));
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
      // Canje: el código single-use vale 120 s; la sesión viaja por HTTPS y
      // se guarda en SecureStore (nunca por el scheme ni en AsyncStorage).
      const data = await apiFetch<{ session: string; email: string | null }>('/auth/exchange', {
        method: 'POST',
        body: { code: parsed.code },
      });
      const s: Session = { token: data.session, email: data.email ?? parsed.email };
      await saveSession(s);
      setSession(s);
    } catch (err) {
      setLastAuthError(err instanceof ApiError ? err.code : 'unknown');
    }
  }, []);

  const signOut = useCallback(async () => {
    await clearSession();
    setSession(null);
    setLastAuthError(null);
  }, []);

  const value = useMemo(
    () => ({ session, ready, lastAuthError, signInWithGoogle, signOut }),
    [session, ready, lastAuthError, signInWithGoogle, signOut],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): AuthCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useSession fuera de AuthProvider');
  return ctx;
}
