import { describe, it, expect } from 'vitest';
import colors from 'tailwindcss/colors';
import { BRAND } from '@sports/brand';

/**
 * WCAG 1.4.11 (contraste de elementos no textuales): un indicador de foco debe
 * alcanzar 3:1 contra las superficies adyacentes.
 *
 * En modo oscuro el anillo `ring-rink-passion` (granate #9E1235) se queda en
 * ~2,3:1 sobre las superficies oscuras de la app — el valor medido en la
 * auditoría (#364). Por eso los inputs/selects usan `dark:focus:ring-rink-accent`.
 * Este test fija la decisión sobre los tokens reales: si alguien toca la paleta,
 * salta.
 */
const DARK_SURFACES = [
  '#111a2e',        // .dark .card de globals.css
  colors.slate[900], // fondo de inputs (dark:bg-slate-900)
];

function luminance(hex: string): number {
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const n = Number.parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255)
    + 0.7152 * channel((n >> 8) & 255)
    + 0.0722 * channel(n & 255);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('anillo de foco en modo oscuro (#364)', () => {
  it('rink-passion (granate) no llega a 3:1 sobre fondo oscuro', () => {
    for (const bg of DARK_SURFACES) {
      expect(contrast(BRAND.granate, bg)).toBeLessThan(3);
    }
  });

  it('rink-accent (accent) cumple el 3:1 mínimo sobre fondo oscuro', () => {
    for (const bg of DARK_SURFACES) {
      expect(contrast(BRAND.accent, bg)).toBeGreaterThanOrEqual(3);
    }
  });
});
