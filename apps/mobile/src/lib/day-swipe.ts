/**
 * day-swipe.ts — gestos de swipe horizontal entre días (PanResponder, borde de
 * Android). Se queda en la app: depende de eventos táctiles de React Native.
 */
export const SWIPE_THRESHOLD_DX = 50;
export const SWIPE_VELOCITY_THRESHOLD = 0.3;

/**
 * Determina si un gesto táctil debe ser capturado para navegación horizontal de días,
 * garantizando que el scroll vertical de la lista de partidos tenga absoluta prioridad.
 */
export function isHorizontalSwipeGesture(dx: number, dy: number): boolean {
  return Math.abs(dx) > 20 && Math.abs(dx) > Math.abs(dy) * 2;
}

/**
 * Resuelve el cambio de días (-1, 0, +1) según la distancia y velocidad del gesto horizontal:
 * - Arrastre a la izquierda (dx < 0): avanza al día siguiente (+1)
 * - Arrastre a la derecha (dx > 0): retrocede al día anterior (-1)
 * - Gesto insuficiente: 0 (sin cambio)
 */
export function resolveDaySwipeDelta(dx: number, vx: number): -1 | 0 | 1 {
  if (dx < -SWIPE_THRESHOLD_DX || (dx < -25 && vx < -SWIPE_VELOCITY_THRESHOLD)) {
    return 1;
  }
  if (dx > SWIPE_THRESHOLD_DX || (dx > 25 && vx > SWIPE_VELOCITY_THRESHOLD)) {
    return -1;
  }
  return 0;
}

/**
 * Ancho en dp de la zona de guarda lateral para no interceptar los gestos
 * nativos del sistema en Android 15 (Predictive Back Gesture de ambos bordes).
 */
export const ANDROID_BACK_GUARD_DP = 32;

/**
 * Extrae el punto de inicio X del gesto táctil en coordenadas de pantalla.
 * En React Native, PanResponder.gestureState.x0 es 0 antes de que el responder sea concedido
 * (onResponderGrant), por lo que durante la fase de captura/evaluación (onMoveShouldSetPanResponderCapture)
 * se debe derivar del evento nativo (evt.nativeEvent.pageX - gestureState.dx) o moveX.
 */
export function extractGestureStartX(
  evt?: { nativeEvent?: { pageX?: number } } | null,
  gestureState?: { dx?: number; moveX?: number; x0?: number } | null,
): number | undefined {
  if (typeof evt?.nativeEvent?.pageX === 'number') {
    return evt.nativeEvent.pageX - (gestureState?.dx ?? 0);
  }
  if (typeof gestureState?.moveX === 'number' && gestureState.moveX > 0) {
    return gestureState.moveX - (gestureState?.dx ?? 0);
  }
  if (typeof gestureState?.x0 === 'number' && gestureState.x0 > 0) {
    return gestureState.x0;
  }
  return undefined;
}

/**
 * Comprueba si el origen del toque (x0) está fuera de las zonas de guarda de los bordes.
 * Si x0 está dentro de los primeros o últimos guardDp píxeles, devuelve false para que
 * el PanResponder ceda el gesto al sistema operativo (Back predictivo en Android 15).
 * Si no se puede determinar x0 (undefined/null), devuelve true para no impedir el swipe.
 */
export function isOutsideEdgeGuard(
  x0: number | undefined | null,
  screenWidth: number,
  guardDp: number = ANDROID_BACK_GUARD_DP,
): boolean {
  if (screenWidth <= guardDp * 2) return true;
  if (x0 === undefined || x0 === null || Number.isNaN(x0)) return true;
  return x0 >= guardDp && x0 <= screenWidth - guardDp;
}
