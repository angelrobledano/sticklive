/**
 * Ejecución con límite de concurrencia.
 *
 * El scraping de muchas competiciones/fichas era secuencial (con una pausa de
 * cortesía entre cada una) para no martillear la fuente. Con ~45 ligas eso se
 * vuelve lento. La palanca correcta no es lanzar todo a la vez —eso SÍ
 * martillearía sidgad— sino un pool de trabajadores con un tope moderado: N
 * peticiones en vuelo como mucho, configurable.
 */

/**
 * Aplica `fn` a cada elemento de `items` con como mucho `limit` en paralelo.
 * Cada invocación va aislada: `fn` debe capturar sus propios errores si no
 * quiere que uno aborte al resto (igual que hacían los bucles originales con su
 * try/catch por item). Resuelve cuando todos han terminado.
 */
export async function forEachLimited<T>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<void>,
): Promise<void> {
  const n = items.length;
  if (n === 0) return;
  const workers = Math.max(1, Math.min(limit, n));
  let next = 0;
  const run = async (): Promise<void> => {
    while (next < n) {
      const i = next++;
      await fn(items[i]!, i);
    }
  };
  await Promise.all(Array.from({ length: workers }, run));
}
