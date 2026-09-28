'use client';

import { useState } from 'react';

const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3000';

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
 */
export function TeamShield({
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
  const containerCls = [
    rounded,
    'bg-slate-100 dark:bg-slate-800',
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

  const src = imgState === 'team'
    ? `${API_URL}/teams/${teamId}/logo`
    : '/escudos/default-team.png';

  // Aire interior: el clip circular recorta las esquinas de los escudos
  // cuadrados (FCB, etc.); un padding proporcional los deja respirar.
  const pad = Math.max(2, Math.round(size * 0.12));

  return (
    <div className={containerCls} style={{ width: size, height: size, padding: pad }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt ?? ''}
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        className="w-full h-full object-contain"
        onError={() => setImgState((prev) => (prev === 'team' ? 'default' : 'initials'))}
      />
    </div>
  );
}
