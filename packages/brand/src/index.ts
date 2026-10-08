/**
 * Tokens de marca de Stick Live (la i) — fuente única para web y app.
 *
 * Solo esta tabla define colores de marca: los `tailwind.config.ts` de `apps/web`
 * y `apps/mobile` importan `BRAND`, y `apps/web/src/lib/og-brand.tsx` también.
 * Ningún otro fichero debería repetir estos hexes.
 *
 * Concepto y reglas: `docs/marca/identidad.md`. El punto de la i lleva el verde
 * fijo en el icono y el logotipo; dentro de la interfaz el verde sigue siendo
 * SOLO el estado «en directo» (Live-Only Color Rule).
 *
 * Contraste (WCAG 2.1, verificado en `tokens.test.ts`):
 *   granate 8.1:1 sobre blanco (AA) · 2.3:1 sobre noche (no apto en oscuro → accent)
 *   accent 6.8:1 sobre noche · liveDeep 5.5:1 con blanco · amberDeep 5.0:1 con blanco
 */
export const BRAND = {
  /** Primario. Granate de identidad (sustituye a rink-passion #991B1B). */
  granate: '#9E1235',
  /** Granate hover sobre superficies claras. */
  granateLight: '#B91C1C',
  /** Granate active/focus sobre superficies claras. */
  granateDark: '#7F1D1D',
  /** Granate de marca cuando el lienzo es oscuro (≥3:1 sobre noche). */
  accent: '#F87171',
  /** Tinta del lockup/isotipo sobre fondos claros. */
  tinta: '#1A0B12',
  /** Fondo oscuro de la interfaz. */
  noche: '#0B1220',
  white: '#FFFFFF',
  /** Punto de «en directo». Uso exclusivamente funcional. */
  live: '#10B981',
  /** Fondo de badge «En directo» (texto blanco AA). */
  liveDeep: '#047857',
  /** Ámbar de descanso/avisos. No usar como relleno decorativo. */
  amber: '#F59E0B',
  /** Fondo de badge de descanso (texto blanco AA). */
  amberDeep: '#B45309',
} as const;

export type BrandColor = keyof typeof BRAND;
