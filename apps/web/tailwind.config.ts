import type { Config } from 'tailwindcss';
import colors from 'tailwindcss/colors';
// Fuente única de los colores de marca (web y app comparten el paquete).
import { BRAND } from '@sports/brand';

const config: Config = {
  // Dark mode controlado por clase en <html>
  darkMode: 'class',

  content: [
    './src/app/**/*.{ts,tsx}',
    './src/components/**/*.{ts,tsx}',
    './src/hooks/**/*.{ts,tsx}',
    './src/lib/**/*.{ts,tsx}',
  ],

  theme: {
    extend: {
      colors: {
        // Granate/burdeos intenso — identidad visual del hockey sobre patines
        'rink-passion': {
          DEFAULT: BRAND.granate,       // #9E1235 (docs/marca/identidad.md)
          light:   BRAND.granateLight,  // #B91C1C  (hover, botones secundarios)
          dark:    BRAND.granateDark,   // #7F1D1D  (active, focus ring)
        },
        // Acento de marca sobre superficie OSCURA (#364): red.800 se queda en
        // ~2,1:1 sobre el fondo azul-noche, así que texto activo, iconos de
        // identidad y anillos de foco suben a red.400 (≥3:1). Identidad, no
        // color semántico de tarjeta/error (ese usa red directo).
        'rink-accent': BRAND.accent, // #F87171 sobre superficies oscuras
        // Verde SOLO para «en directo» (Live-Only Color Rule): punto y estado.
        'live': { DEFAULT: BRAND.live, deep: BRAND.liveDeep },
        // Ámbar de descanso/avisos.
        'halftime': { DEFAULT: BRAND.amber, deep: BRAND.amberDeep },
        // Parqué claro — fondo principal en modo claro; noche #0B1220 en oscuro
        'rink-floor': {
          DEFAULT: colors.slate[50],  // #f8fafc
          dark:    BRAND.noche,       // #0B1220
        },
      },

      fontFamily: {
        // Inter ya se cargaba con `next/font` (variable `--font-inter` en
        // <html>) pero no se aplicaba en ningún sitio: el navegador descargaba
        // la fuente y luego usaba system-ui. Se declara como `sans` para que
        // Tailwind (preflight) la use de verdad, con la pila del sistema como
        // respaldo durante `display: swap`.
        sans: [
          'var(--font-inter)',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'Noto Sans',
          'sans-serif',
          'Apple Color Emoji',
          'Segoe UI Emoji',
        ],
        // Marcadores y estadísticas: monoespaciado potente
        score: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
    },
  },

  plugins: [],
};

export default config;
