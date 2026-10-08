import { useEffect, useState } from 'react';
import { Animated, Easing, Image, View } from 'react-native';
import { BRAND } from '@sports/brand';
import brandMark from '../../../assets/brand-mark.png';

/**
 * Marca de carga con el punto animado: la i sobre granate con el punto de la
 * identidad latiendo. El punto sigue los estados de la marca (identidad.md):
 * en juego verde, descanso ámbar, reposo granate y final gris.
 *
 * El PNG `brand-mark.png` es la i SIN el punto (misma geometría que el icono,
 * derivada de store/marca/la-i-blanca.svg): así el punto se anima aparte. La
 * posición (centro y radio como fracción del lado) es la de ese dibujo.
 */
const DOT_CX = 0.4781;
const DOT_CY = 0.2664;
const DOT_R = 0.0946;

const DOT_COLOR = {
  rest: BRAND.granate,
  live: BRAND.live,
  halftime: BRAND.amber,
  final: '#94A3B8',
} as const;

export type BrandDotState = keyof typeof DOT_COLOR;

export function BrandLoader({ size = 72, state = 'live' }: { size?: number; state?: BrandDotState }) {
  // useState (no useRef): instancia estable de Animated.Value sin leer refs en
  // render (regla react-hooks/refs del compilador).
  const [pulse] = useState(() => new Animated.Value(1));

  useEffect(() => {
    // Latido continuo del punto (opacidad; no reflow). Sigue la Live-Only rule:
    // el pulso solo tiene sentido con la marca viva, y reduce-motion lo ignora
    // en el sistema (no se puede detectar aquí sin librería extra).
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.3, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const dot = size * DOT_R * 2;
  return (
    <View style={{ width: size, height: size }} accessibilityRole="progressbar" accessibilityLabel="Cargando">
      <Image source={brandMark} style={{ width: size, height: size }} resizeMode="contain" />
      <Animated.View
        style={{
          position: 'absolute',
          left: (DOT_CX - DOT_R) * size,
          top: (DOT_CY - DOT_R) * size,
          width: dot,
          height: dot,
          borderRadius: dot / 2,
          backgroundColor: DOT_COLOR[state],
          opacity: pulse,
        }}
      />
    </View>
  );
}
