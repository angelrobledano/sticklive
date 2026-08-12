'use client';

import { useState } from 'react';
import { useFavorites } from '@/hooks/useFavorites';
import { getPreset } from '@/lib/notif-prefs';
import { NotificationPresetSheet } from '@/components/shared/NotificationPresetSheet';

type Kind = 'team' | 'league' | 'player';

/**
 * Campana de "gestionar notificaciones" junto al botón de seguir. Solo se muestra
 * si la entidad está seguida (sin follow, el preset no se sincroniza). Abre el
 * mismo selector de presets que aparece al empezar a seguir.
 */
export function ManageNotificationsButton({ kind, id, name, className = '' }: {
  kind: Kind;
  id: string;
  name?: string;
  className?: string;
}) {
  const { isFavorite, isLeagueFavorite, isPlayerFavorite, mounted } = useFavorites();
  const [open, setOpen] = useState(false);

  if (!mounted) return null;
  const followed =
    kind === 'team' ? isFavorite(id)
    : kind === 'league' ? isLeagueFavorite(id)
    : isPlayerFavorite(id);
  if (!followed) return null;

  const silent = getPreset(kind, id) === 'silent';

  return (
    <>
      <button
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(true); }}
        aria-label="Gestionar notificaciones"
        className={`inline-flex items-center justify-center w-11 h-11 rounded-full
                    text-slate-500 dark:text-slate-400 hover:text-rink-passion
                    transition-transform active:scale-90 ${className}`}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} className="w-5 h-5">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M13.7 21a2 2 0 0 1-3.4 0" strokeLinecap="round" />
          {silent && <path d="M2 2l20 20" strokeLinecap="round" />}
        </svg>
      </button>
      <NotificationPresetSheet open={open} kind={kind} id={id} name={name} onClose={() => setOpen(false)} />
    </>
  );
}
