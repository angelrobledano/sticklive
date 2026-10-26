import { useLockScreenLiveMatches } from '@/src/hooks/useLockScreenLiveMatches';

/**
 * Componente centinela sin interfaz visual que mantiene sincronizadas
 * las notificaciones de partidos en directo en la pantalla de bloqueo.
 * Vive en la raíz del árbol dentro del QueryClientProvider.
 */
export function LockScreenLiveTracker() {
  useLockScreenLiveMatches();
  return null;
}
