import { describe, expect, it } from 'vitest';
import {
  extractGestureStartX,
  isHorizontalSwipeGesture,
  isOutsideEdgeGuard,
  resolveDaySwipeDelta,
} from './day-swipe';

describe('swipe gesture navigation', () => {
  it('isHorizontalSwipeGesture solo intercepta gestos predominantemente horizontales', () => {
    // Movimiento horizontal claro
    expect(isHorizontalSwipeGesture(30, 5)).toBe(true);
    expect(isHorizontalSwipeGesture(-40, 10)).toBe(true);

    // Movimiento vertical (scroll normal del feed de partidos)
    expect(isHorizontalSwipeGesture(5, 30)).toBe(false);
    expect(isHorizontalSwipeGesture(15, 20)).toBe(false);

    // Movimiento diagonal
    expect(isHorizontalSwipeGesture(30, 25)).toBe(false);

    // Movimiento diminuto / temblor por debajo del umbral mínimo
    expect(isHorizontalSwipeGesture(15, 2)).toBe(false);
    expect(isHorizontalSwipeGesture(-10, 0)).toBe(false);
  });

  it('resolveDaySwipeDelta resuelve correctamente navegación de día siguiente o anterior', () => {
    // Desplazamiento a la izquierda -> siguiente día (+1)
    expect(resolveDaySwipeDelta(-60, 0)).toBe(1);
    // Flick rápido a la izquierda -> siguiente día (+1)
    expect(resolveDaySwipeDelta(-30, -0.4)).toBe(1);

    // Desplazamiento a la derecha -> día anterior (-1)
    expect(resolveDaySwipeDelta(60, 0)).toBe(-1);
    // Flick rápido a la derecha -> día anterior (-1)
    expect(resolveDaySwipeDelta(30, 0.4)).toBe(-1);

    // Desplazamiento insuficiente o velocidad neutra -> sin cambio (0)
    expect(resolveDaySwipeDelta(15, 0.1)).toBe(0);
    expect(resolveDaySwipeDelta(-20, 0)).toBe(0);
    // Desplazamiento a la izquierda pero velocidad opuesta
    expect(resolveDaySwipeDelta(-30, 0.2)).toBe(0);
  });

  it('isOutsideEdgeGuard protege los bordes para el gesto Atrás de Android 15', () => {
    const screenWidth = 390;
    // Toque en el borde izquierdo (0..31dp) -> en zona de guarda (false)
    expect(isOutsideEdgeGuard(0, screenWidth)).toBe(false);
    expect(isOutsideEdgeGuard(15, screenWidth)).toBe(false);
    expect(isOutsideEdgeGuard(31, screenWidth)).toBe(false);

    // Toque en el borde derecho (359..390dp) -> en zona de guarda (false)
    expect(isOutsideEdgeGuard(359, screenWidth)).toBe(false);
    expect(isOutsideEdgeGuard(380, screenWidth)).toBe(false);
    expect(isOutsideEdgeGuard(390, screenWidth)).toBe(false);

    // Toques en el cuerpo central -> permitidos para swiping (true)
    expect(isOutsideEdgeGuard(32, screenWidth)).toBe(true);
    expect(isOutsideEdgeGuard(195, screenWidth)).toBe(true);
    expect(isOutsideEdgeGuard(358, screenWidth)).toBe(true);

    // Si no se pudo determinar x0 (undefined / null), ser permisivo para no romper navegación
    expect(isOutsideEdgeGuard(undefined, screenWidth)).toBe(true);
    expect(isOutsideEdgeGuard(null, screenWidth)).toBe(true);
  });

  it('extractGestureStartX deriva x0 fielmente a partir de pageX y dx', () => {
    // Evento nativo con pageX y dx
    expect(extractGestureStartX({ nativeEvent: { pageX: 180 } }, { dx: -30 })).toBe(210);
    expect(extractGestureStartX({ nativeEvent: { pageX: 180 } }, { dx: 40 })).toBe(140);

    // Fallback a moveX si no hay pageX
    expect(extractGestureStartX(null, { moveX: 200, dx: -20 })).toBe(220);

    // Fallback a x0 concedido si moveX es 0
    expect(extractGestureStartX(null, { x0: 150 })).toBe(150);

    // Indefinido si no hay datos de coordenadas
    expect(extractGestureStartX(null, { x0: 0, moveX: 0 })).toBeUndefined();
  });
});

