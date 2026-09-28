import { describe, it, expect } from 'vitest';
import colors from 'tailwindcss/colors';

/**
 * WCAG 1.4.3 (#360): los badges y textos pequeños deben alcanzar 4,5:1. La
 * auditoría midió 2,15–2,56:1 en `*-500 s/ blanco` y `slate-400 s/ blanco`.
 * Este test fija las decisiones tomadas en los componentes de la whitelist: si
 * alguien vuelve a la paleta anterior, salta.
 */

function channel(v: number): number {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255)
    + 0.7152 * channel((n >> 8) & 255)
    + 0.0722 * channel(n & 255);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Mezcla `fg` sobre `bg` con opacidad `alpha` (texto con `/80`). */
function blend(fg: string, bg: string, alpha: number): string {
  const f = Number.parseInt(fg.slice(1), 16);
  const b = Number.parseInt(bg.slice(1), 16);
  const mix = (shift: number) => {
    const fv = (f >> shift) & 255;
    const bv = (b >> shift) & 255;
    return Math.round(alpha * fv + (1 - alpha) * bv);
  };
  return `#${[mix(16), mix(8), mix(0)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

describe('contraste de badges y texto pequeño (#360)', () => {
  it('badge "Mis Ligas": slate-900 sobre amber-600 ≥ 4,5:1', () => {
    expect(contrast(colors.slate[900], colors.amber[600])).toBeGreaterThanOrEqual(4.5);
  });

  it('texto atenuado: slate-500 sobre blanco ≥ 4,5:1', () => {
    expect(contrast(colors.slate[500], '#ffffff')).toBeGreaterThanOrEqual(4.5);
  });

  it('cabecera de clasificación: slate-600 sobre slate-50 ≥ 4,5:1', () => {
    expect(contrast(colors.slate[600], colors.slate[50])).toBeGreaterThanOrEqual(4.5);
  });

  it('badge Premium: slate-900 sobre el extremo oscuro (amber-500) ≥ 4,5:1', () => {
    expect(contrast(colors.slate[900], colors.amber[500])).toBeGreaterThanOrEqual(4.5);
  });

  it('badge Premium (texto /80): mezcla slate-900/80 sobre amber-500 ≥ 4,5:1', () => {
    const composited = blend(colors.slate[900], colors.amber[500], 0.8);
    expect(contrast(composited, colors.amber[500])).toBeGreaterThanOrEqual(4.5);
  });
});
