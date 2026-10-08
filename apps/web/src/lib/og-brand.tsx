/**
 * Marca de Stick Live para las imágenes sociales (next/og · Satori).
 *
 * El lockup (plato granate con la i + logotipo «stick live») va como PNG en
 * data URI: no depende de fuentes ni de red, y Satori no pinta de forma fiable
 * los SVG en data URI (ver matches/[id]/lineup-image/route.tsx). Fuente del
 * dibujo: store/marca/lock-on-dark.svg.
 */

import { BRAND } from '@sports/brand';

/** Colores de marca para fondos oscuros (tablero «Sistema de La i»). */
export const OG_BRAND = {
  night: BRAND.noche,
  granate: BRAND.granate,
  live: BRAND.live,
  text: '#f8fafc',
  muted: '#94a3b8',
} as const;

/** Lockup para fondo oscuro, 518×96 px (2× de 48 px de alto). */
const LOCKUP_SRC =
  'data:image/png;base64,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';
const LOCKUP_RATIO = 518 / 96;

/** Lockup de marca a la altura indicada (48 px en las tarjetas de 1200×630). */
export function OgLockup({ height = 48 }: { height?: number }) {
  const width = Math.round(height * LOCKUP_RATIO);
  // eslint-disable-next-line @next/next/no-img-element -- next/og (satori) requiere <img>, no next/image
  return <img src={LOCKUP_SRC} width={width} height={height} style={{ width, height }} alt="Stick Live" />;
}

/** Franja granate inferior: la firma de color de todas las tarjetas. */
export function OgBrandStrip() {
  return (
    <div style={{
      position: 'absolute', left: 0, right: 0, bottom: 0, height: '10px',
      display: 'flex', background: OG_BRAND.granate,
    }} />
  );
}
