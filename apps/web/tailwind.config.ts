import type { Config } from 'tailwindcss';
import colors from 'tailwindcss/colors';

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
          DEFAULT: colors.red[800],   // #991b1b
          light:   colors.red[700],   // #b91c1c  (hover, botones secundarios)
          dark:    colors.red[900],   // #7f1d1d  (active, focus ring)
        },
        // Acento de marca sobre superficie OSCURA (#364): red.800 se queda en
        // ~2,1:1 sobre el fondo azul-noche, así que texto activo, iconos de
        // identidad y anillos de foco suben a red.400 (≥3:1). Identidad, no
        // color semántico de tarjeta/error (ese usa red directo).
        'rink-accent': colors.red[400], // #f87171
        // Parqué claro — fondo principal en modo claro
        'rink-floor': {
          DEFAULT: colors.slate[50],  // #f8fafc
          dark:    colors.slate[950], // #020617  (fondo en dark mode)
        },
      },

      fontFamily: {
        // Marcadores y estadísticas: monoespaciado potente
        score: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
    },
  },

  plugins: [],
};

export default config;
