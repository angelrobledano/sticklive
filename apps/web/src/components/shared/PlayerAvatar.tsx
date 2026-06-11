'use client';

import { useState } from 'react';

/**
 * Avatar de jugador con fallback: si la foto de sidgad no existe (404),
 * se muestra la silueta neutra en su lugar.
 */
export function PlayerAvatar({ photoUrl, name, className = 'w-20 h-20 rounded-2xl' }: {
  photoUrl: string | null | undefined;
  name: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const showPhoto = !!photoUrl && !failed;

  return (
    <div className={`${className} bg-slate-100 dark:bg-slate-800 flex items-center justify-center overflow-hidden`}>
      {showPhoto ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={photoUrl!}
          alt={name}
          className="w-full h-full object-cover object-top"
          onError={() => setFailed(true)}
          loading="lazy"
        />
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
