'use client';

import { useState } from 'react';
import Image from 'next/image';

interface TeamShieldProps {
  /** UUID del equipo — define /escudos/{teamId}.png como src primario */
  teamId: string;
  /** Nombre del equipo — usado en alt y como texto del fallback de iniciales */
  teamName: string;
  /** Lado en px (width = height). Default: 40 */
  size?: number;
  /** Clase de border-radius Tailwind. Default: 'rounded-full' */
  rounded?: string;
  /** Clases extra para el contenedor (p.ej. 'shrink-0', 'p-1') */
  className?: string;
}

type ImgState = 'team' | 'default' | 'initials';

/**
 * Escudo de equipo con fallback en 3 niveles:
 *   1. /escudos/{teamId}.png  (imagen local, la normal)
 *   2. /escudos/default-team.png  (logo generico si no hay escudo)
 *   3. Circulo con iniciales en font-mono
 */
export function TeamShield({
  teamId,
  teamName,
  size = 40,
  rounded = 'rounded-full',
  className = '',
}: TeamShieldProps) {
  const [imgState, setImgState] = useState<ImgState>('team');

  const initials = teamName.slice(0, 2).toUpperCase();
  const containerCls = [
    rounded,
    'bg-slate-100 dark:bg-slate-800',
    'shrink-0 flex items-center justify-center overflow-hidden',
    className,
  ].filter(Boolean).join(' ');

  // Fallback de iniciales
  if (imgState === 'initials') {
    return (
      <div
        className={`${containerCls} bg-slate-200 dark:bg-slate-700`}
        style={{ width: size, height: size, fontSize: Math.max(8, Math.floor(size * 0.3)) }}
        aria-label={teamName}
      >
        <span className="font-mono font-bold text-slate-600 dark:text-slate-300 select-none leading-none">
          {initials}
        </span>
      </div>
    );
  }

  const src = imgState === 'team'
    ? `/escudos/${teamId || '_unknown'}.png`
    : '/escudos/default-team.png';

  // Aire interior: el clip circular recorta las esquinas de los escudos
  // cuadrados (FCB, etc.); un padding proporcional los deja respirar.
  const pad = Math.max(2, Math.round(size * 0.12));

  return (
    <div className={containerCls} style={{ width: size, height: size, padding: pad }}>
      <Image
        src={src}
        alt={teamName}
        width={size}
        height={size}
        className="w-full h-full object-contain"
        onError={() =>
          setImgState((prev) => (prev === 'team' ? 'default' : 'initials'))
        }
      />
    </div>
  );
}
