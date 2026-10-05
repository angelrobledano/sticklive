import type { Config } from 'tailwindcss';
import colors from 'tailwindcss/colors';

export default {
  darkMode: 'class',
  content: ['./app/**/*.{ts,tsx}', './src/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        'rink-passion': {
          DEFAULT: colors.red[800],
          light: colors.red[700],
          dark: colors.red[900],
        },
        'rink-floor': {
          DEFAULT: colors.slate[50],
          dark: colors.slate[950],
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
