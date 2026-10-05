import * as SecureStore from 'expo-secure-store';

const TOKEN_KEY = 'sticklive.session.token';
const EMAIL_KEY = 'sticklive.session.email';
/** Prefijo de las URLs de retorno del login; el scheme vive en app.config.ts. */
const CALLBACK_PREFIX = 'sticklive://auth/callback';

export interface Session {
  token: string;
  email: string | null;
}

/** Extrae el código de canje del redirect `sticklive://auth/callback?code=…`. */
export function parseAuthRedirect(url: string): { code: string; email: string | null } | null {
  if (!url.startsWith(CALLBACK_PREFIX)) return null;
  const params = new URLSearchParams(url.slice(CALLBACK_PREFIX.length));
  // Un redirect con ?error=… no lleva code: el fallo lo reporta parseAuthError.
  if (params.get('error') || !params.get('code')) return null;
  return { code: params.get('code')!, email: params.get('email') };
}

/**
 * Motivo de error que el callback del API redirige por el scheme
 * (`sticklive://auth/callback?error=<reason>`; el fail() del API es consciente
 * del cliente app). null si la URL no es del callback o no trae error.
 */
export function parseAuthError(url: string): string | null {
  if (!url.startsWith(CALLBACK_PREFIX)) return null;
  return new URLSearchParams(url.slice(CALLBACK_PREFIX.length)).get('error') || null;
}

export async function saveSession(s: Session): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, s.token);
  if (s.email) await SecureStore.setItemAsync(EMAIL_KEY, s.email);
}

export async function loadSession(): Promise<Session | null> {
  const token = await SecureStore.getItemAsync(TOKEN_KEY);
  if (!token) return null;
  return { token, email: await SecureStore.getItemAsync(EMAIL_KEY) };
}

export async function clearSession(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
  await SecureStore.deleteItemAsync(EMAIL_KEY);
}
