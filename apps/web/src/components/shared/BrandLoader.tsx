import { BRAND } from '@sports/brand';

/**
 * Marca de carga con el punto animado: la i sobre granate con el punto de la
 * identidad latiendo (CSS, respeta reduce-motion vía `.animate-pulse`). El punto
 * sigue los estados de la marca (identidad.md): en juego verde, descanso ámbar,
 * reposo granate y final gris.
 *
 * El dibujo (cuadrado redondeado + i + punto) es el mismo que `app/icon.svg`,
 * partido de store/marca/. SVG en línea para poder animar solo el punto.
 */
const DOT_COLOR = {
  rest: BRAND.granate,
  live: BRAND.live,
  halftime: BRAND.amber,
  final: '#94A3B8',
} as const;

export type BrandDotState = keyof typeof DOT_COLOR;

export function BrandLoader({
  size = 48,
  state = 'live',
  className = '',
}: {
  size?: number;
  state?: BrandDotState;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label="Cargando"
    >
      <rect width="64" height="64" rx="14" fill={BRAND.granate} />
      <svg x="18.76" y="11" width="26.47" height="42" viewBox="26.1 9.5 50.3 79.8" preserveAspectRatio="xMidYMid meet">
        <g transform="translate(-0.97 0) skewX(-8)">
          <path
            d="M 44 43 V 63 A 18.5 18.5 0 0 0 79.4 70.52"
            fill="none"
            stroke="#FFFFFF"
            strokeWidth="15.5"
            strokeLinecap="butt"
          />
          <circle cx="79.4" cy="70.52" r="7.75" fill="#FFFFFF" />
        </g>
        <circle cx="48.6" cy="21" r="11.5" fill={DOT_COLOR[state]} className="animate-pulse" />
      </svg>
    </svg>
  );
}
