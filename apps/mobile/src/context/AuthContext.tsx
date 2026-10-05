import * as WebBrowser from 'expo-web-browser';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { API_URL, apiFetch, ApiError } from '@/src/lib/api/client';
import { capture, identifyUser } from '@/src/lib/analytics';
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
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [lastAuthError, setLastAuthError] = useState<string | null>(null);

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
      // Analítica (Task 5.1): identificar con el email ANTES del capture de
      // login_completed (así el evento ya cae en la persona de la cuenta; el
      // SDK fusiona la persona anónima del deviceId con la del email). Sin
      // email en el canje no hay identify: la persona sigue siendo el deviceId.
      // identifyUser no lanza (try/catch interno) y el capture tampoco: la
      // analítica no puede romper un login correcto.
      if (s.email) identifyUser(s.email);
      capture('login_completed', { method: 'google' });
      // Fusión de favoritos anónimos → cuenta (merge idempotente, Task 3.3).
      // ANTES de setSession: la primera lectura de favoritos ya ve el estado
      // fusionado y no hay flash de "0 favoritos". Si falla (red) el login NO
      // se rompe: los locales sobreviven intactos y el merge se reintenta con
      // el próximo login. Tocar la estrella también dispara su propio merge,
      // pero recupera SOLO ese favorito (merge de 1 elemento); el resto del
      // estado local se recupera con el próximo login.
      // Fallo explícito no silencioso por consola (mismo canal que signOut;
      // Sentry lo capturará en 5.1): meterlo en lastAuthError mostraría un
      // error de Google cuando el login ha IDO BIEN.
      try {
        await mergeLocalOnLogin(s.token);
      } catch (mergeErr) {
        console.error('[auth] no se pudieron fusionar los favoritos locales con la cuenta', mergeErr);
      }
      setSession(s);
    } catch (err) {
      setLastAuthError(err instanceof ApiError ? err.code : 'unknown');
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
      setSession(null);
    }
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
