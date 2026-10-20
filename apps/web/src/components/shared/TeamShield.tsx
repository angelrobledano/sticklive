'use client';

import { memo, useState } from 'react';

const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3000';

/**
 * Anchos que sabe servir la API (`?w=`, #335). Deben ser presets soportados por
 * `apps/api/src/lib/image.ts`; si no, la API redondea al preset mayor.
 */
const LOGO_WIDTHS = [32, 64, 96, 144, 192, 256] as const;

interface TeamShieldProps {
  /** UUID del equipo — define el escudo vía la API (/teams/:id/logo) */
  teamId: string;
  /** Nombre del equipo — usado en alt y como texto del fallback de iniciales */
  teamName: string;
  /** Lado en px (width = height). Default: 40 */
  size?: number;
  /** Clase de border-radius Tailwind. Default: 'rounded-full' */
  rounded?: string;
  /** Clases extra para el contenedor (p.ej. 'shrink-0', 'p-1') */
  className?: string;
  /**
   * Texto alternativo. Por defecto vacío (decorativo): en la app el nombre del
   * equipo/las siglas SIEMPRE van visibles al lado, así que repetirlo aquí haría
   * que los lectores de pantalla lo leyeran dos veces (#364).
   */
  alt?: string;
}

type ImgState = 'team' | 'default' | 'initials';

/**
 * Escudo de equipo con fallback en 3 niveles (auditoría A3):
 *   1. {API}/teams/{id}/logo  → la API lo sirve del volumen o hace proxy del CDN
 *      (fuente única = teams.logo_url; sin reiniciar `web` al añadir escudos).
 *   2. /escudos/default-team.png  (genérico horneado, siempre presente)
 *   3. Círculo con iniciales
 *
 * Se usa <img> (no next/image) a propósito: la URL es dinámica y NO queremos que
 * el optimizador de Next cachee un 404 de un escudo que aún no existía.
 *
 * #335 (perf P0): el escudo original pesa hasta 2,4 MB y aquí se pinta a 20–80
 * px. El `srcSet`+`sizes` hace que el navegador pida a la API sólo el ancho
 * necesario (con 2× para pantallas retina), y la API lo sirve redimensionado.
 */
function TeamShieldImpl({
  teamId,
  teamName,
  size = 40,
  rounded = 'rounded-full',
  className = '',
  alt,
}: TeamShieldProps) {
  // Sin teamId no hay escudo posible → directo al genérico.
  const [imgState, setImgState] = useState<ImgState>(teamId ? 'team' : 'default');
  const decorative = !alt;

  const initials = teamName.slice(0, 2).toUpperCase();
  // OJO: el fondo NO va aquí compartido; va solo en la rama de imagen. Si
  // estuviera en containerCls, ganaría al bg-slate-200 del fallback de iniciales.
  const containerCls = [
    rounded,
    'shrink-0 flex items-center justify-center overflow-hidden',
    className,
  ].filter(Boolean).join(' ');

  if (imgState === 'initials') {
    return (
      <div
        className={`${containerCls} bg-slate-200 dark:bg-slate-700`}
        style={{ width: size, height: size, fontSize: Math.max(8, Math.floor(size * 0.3)) }}
        {...(decorative ? { 'aria-hidden': true } : { 'aria-label': alt })}
      >
        <span className="font-mono font-bold text-slate-600 dark:text-slate-300 select-none leading-none">
          {initials}
        </span>
      </div>
    );
  }

  const isTeam = imgState === 'team';
  const src = isTeam
    ? `${API_URL}/teams/${teamId}/logo?w=96`
    : '/escudos/default-team.png';
  // 2× para retina; la API redondea al preset soportado más cercano por arriba.
  const srcSet = isTeam
    ? LOGO_WIDTHS.map((w) => `${API_URL}/teams/${teamId}/logo?w=${w} ${w}w`).join(', ')
    : undefined;

  // Sin padding: el margen uniforme ya viene horneado en el escudo normalizado.
  // Badge blanco en AMBOS temas (bg-white sin dark:): el escudo normalizado ya
  // trae relleno blanco horneado, así que el contenedor debe casar con él (si no,
  // en modo oscuro aparecería un anillo oscuro alrededor del badge).
  return (
    <div className={`${containerCls} bg-white`} style={{ width: size, height: size }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        srcSet={srcSet}
        sizes={`${size}px`}
        alt={alt ?? ''}
        width={size}
        height={size}
        loading={size >= 64 ? 'eager' : 'lazy'}
        decoding="async"
        className="w-full h-full object-contain"
        onError={() => setImgState((prev) => (prev === 'team' ? 'default' : 'initials'))}
      />
    </div>
  );
}

/**
 * Memoizado: en listas largas (jornada, clasificación, plantilla) los escudos
 * reciben siempre las mismas props y no deben re-renderizarse cuando cambia el
 * marcador de otra fila.
 */
export const TeamShield = memo(TeamShieldImpl);
