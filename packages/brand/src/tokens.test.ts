import { describe, it, expect } from 'vitest';
import { BRAND } from './index.js';

/**
 * Los tokens de marca son una regla de accesibilidad, no un gusto: si alguien
 * mueve un hex, este test lo caza. Ratios WCAG 2.1 sobre las parejas reales de
 * uso (no sobre combinaciones arbitrarias).
 */

/** Luminancia relativa WCAG de un color `#rrggbb`. */
function luminance(hex: string): number {
  const n = parseInt(hex.replace('#', ''), 16);
  const toLinear = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const r = toLinear((n >> 16) & 0xff);
  const g = toLinear((n >> 8) & 0xff);
  const b = toLinear(n & 0xff);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Ratio de contraste WCAG entre dos colores (mayor = más contraste). */
function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

describe('BRAND — contrasteAA', () => {
  it('granate cumple AA (≥4.5:1) sobre blanco', () => {
    expect(contrast(BRAND.granate, BRAND.white)).toBeGreaterThanOrEqual(4.5);
  });

  it('las variantes claro/oscuro del granate cumplen AA sobre blanco', () => {
    expect(contrast(BRAND.granateLight, BRAND.white)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(BRAND.granateDark, BRAND.white)).toBeGreaterThanOrEqual(4.5);
  });

  it('el granate de marca sobre oscuro (accent) cumple ≥3:1 sobre noche', () => {
    expect(contrast(BRAND.accent, BRAND.noche)).toBeGreaterThanOrEqual(3);
  });

  it('el badge de directo (liveDeep) y el de descanso (amberDeep) cumplen AA con texto blanco', () => {
    expect(contrast(BRAND.liveDeep, BRAND.white)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(BRAND.amberDeep, BRAND.white)).toBeGreaterThanOrEqual(4.5);
  });

  it('la tinta del logotipo cumple AA sobre blanco', () => {
    expect(contrast(BRAND.tinta, BRAND.white)).toBeGreaterThanOrEqual(4.5);
  });

  it('el verde de directo no es apto para texto sobre blanco (señal, no texto)', () => {
    expect(contrast(BRAND.live, BRAND.white)).toBeLessThan(4.5);
  });
});
