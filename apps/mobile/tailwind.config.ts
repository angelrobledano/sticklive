import type { Config } from 'tailwindcss';
import colors from 'tailwindcss/colors';
// Fuente única de los colores de marca (web y app comparten el paquete).
import { BRAND } from '@sports/brand';

export default {
  darkMode: 'class',
  content: ['./app/**/*.{ts,tsx}', './src/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        'rink-passion': {
          DEFAULT: BRAND.granate,       // #9E1235
          light:   BRAND.granateLight,  // #B91C1C
          dark:    BRAND.granateDark,   // #7F1D1D
        },
        // Verde SOLO para «en directo» (Live-Only Color Rule): punto y estado.
        'live': { DEFAULT: BRAND.live, deep: BRAND.liveDeep },
        // Ámbar de descanso/avisos.
        'halftime': { DEFAULT: BRAND.amber, deep: BRAND.amberDeep },
        'rink-floor': {
          DEFAULT: colors.slate[50],
          dark: colors.slate[950],
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
