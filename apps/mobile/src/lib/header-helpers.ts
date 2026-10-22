import { Platform } from 'react-native';

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

/**
 * Devuelve el nombre del icono de compartir según la plataforma:
 * - Android: 'share-social' (el icono canónico de 3 nodos conectados)
 * - iOS y otros: 'share-outline' (el icono de caja con flecha hacia arriba)
 */
export function getShareIconName(
  os: string = Platform.OS,
): 'share-social' | 'share-outline' {
  return os === 'android' ? 'share-social' : 'share-outline';
}
