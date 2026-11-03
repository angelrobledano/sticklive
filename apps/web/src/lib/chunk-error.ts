/**
 * Errores de carga de chunks (auditoría UX 03/11/2026, #7). Justo después de un
 * despliegue, una página cacheada puede pedir un JS que ya no existe. Recargar
 * lo arregla, así que el boundary recarga UNA vez por minuto como mucho (si
 * no, un chunk roto de verdad haría un bucle).
 */
const KEY = 'rink-chunk-reload-at';
const WINDOW_MS = 60_000;

export function isChunkLoadError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return err.name === 'ChunkLoadError'
    || /Loading (CSS )?chunk [\w-]+ failed/i.test(err.message)
    || /dynamically imported module/i.test(err.message);
}

interface MiniStorage { getItem(k: string): string | null; setItem(k: string, v: string): void }

export function shouldAutoReload(store: MiniStorage, now: number = Date.now()): boolean {
  try {
    const last = Number(store.getItem(KEY) ?? 0);
    if (last && now - last < WINDOW_MS) return false;
    store.setItem(KEY, String(now));
    return true;
  } catch {
    return false;
  }
}
