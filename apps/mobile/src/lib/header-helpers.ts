/**
 * Determina si debe mostrarse el botón rápido "Hoy" en la cabecera.
 */
export function shouldShowTodayButton(
  selectedDate?: string | null,
  todayKey?: string | null,
): boolean {
  if (!selectedDate || !todayKey) return false;
  return selectedDate !== todayKey;
}
