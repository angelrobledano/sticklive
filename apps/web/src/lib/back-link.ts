/**
 * Decidir si el botón "Volver" puede usar el historial del navegador (#182).
 *
 * `window.history.length > 1` no sirve como criterio: un deep-link desde Google
 * se abre en una pestaña con historial previo, así que `router.back()` devolvía
 * al buscador. Solo volvemos al historial si el referrer es del propio sitio; en
 * cualquier otro caso (referrer externo, vacío o inválido) usamos el `href` de
 * respaldo.
 */
export function shouldReturnToHistory(referrer: string, origin: string): boolean {
  if (!referrer) return false;
  try {
    return new URL(referrer).origin === origin;
  } catch {
    return false;
  }
}
