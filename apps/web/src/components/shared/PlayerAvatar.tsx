'use client';

import { useState } from 'react';
import Image from 'next/image';

const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3000';

/**
 * Hosts externos que Next puede optimizar. Debe coincidir con
 * `images.remotePatterns` de next.config.mjs: pasar por next/image una URL de un
 * host no declarado lanza error en render, así que fuera de esta lista servimos
 * con <img> tal cual.
 */
const OPTIMIZABLE_HOSTS = new Set([
  'sidgad.cloud',
  'www.server2.sidgad.es',
  'www.hockeypatines.fep.es',
  'hockeypatines.fep.es',
]);

// Se pinta a 32–80 px (ver usos); 96 px cubre 2× sin acercarse al original.
const PHOTO_WIDTH = 96;

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null; // URL relativa → la sirve nuestra propia API
  }
}

/** Añade `?w=` respetando si la URL ya trae query string. */
function withWidth(url: string, width: number): string {
  return `${url}${url.includes('?') ? '&' : '?'}w=${width}`;
}

/**
 * Avatar de jugador con fallback: si la foto de sidgad no existe (404),
 * se muestra la silueta neutra en su lugar.
 *
 * #335 (perf P0): la ficha original puede pesar >1 MB y aquí se pinta a 32–80
 * px. Las fotos del CDN se sirven con next/image (redimensiona + srcset); las
 * de nuestra API, que ya redimensiona, reciben `?w=`.
 */
export function PlayerAvatar({ photoUrl, name, className = 'w-20 h-20 rounded-2xl' }: {
  photoUrl: string | null | undefined;
  name: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const showPhoto = !!photoUrl && !failed;

  const host = showPhoto ? hostnameOf(photoUrl!) : null;
  const optimizable = host !== null && OPTIMIZABLE_HOSTS.has(host);
  const ownApi = showPhoto && (host === null || photoUrl!.startsWith(API_URL));

  return (
    <div className={`${className} bg-slate-100 dark:bg-slate-800 flex items-center justify-center overflow-hidden`}>
      {showPhoto ? (
        optimizable ? (
          // CDN externo (sidgad): next/image lo redimensiona y sirve srcset.
          <Image
            src={photoUrl!}
            alt={name}
            width={PHOTO_WIDTH}
            height={PHOTO_WIDTH}
            sizes={`${PHOTO_WIDTH}px`}
            className="w-full h-full object-cover object-top"
            onError={() => setFailed(true)}
          />
        ) : (
          // Nuestra API ya redimensiona (`?w=`); el resto de URLs externas sin
          // configurar en Next se sirven tal cual (no podemos transformarlas).
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={ownApi ? withWidth(photoUrl!, PHOTO_WIDTH * 2) : photoUrl!}
            alt={name}
            className="w-full h-full object-cover object-top"
            onError={() => setFailed(true)}
            loading="lazy"
            decoding="async"
          />
        )
      ) : (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1}
             className="w-3/5 h-3/5 text-slate-300 dark:text-slate-600">
          <circle cx="12" cy="8" r="4" />
          <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
        </svg>
      )}
    </div>
  );
}
