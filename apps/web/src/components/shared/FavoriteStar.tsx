'use client';

import { useEffect, useState } from 'react';
import { useFavorites } from '@/hooks/useFavorites';
import { useT } from '@/lib/i18n';
import { setPreset } from '@/lib/notif-prefs';
import { syncPushConfig } from '@/lib/push';
import { NotificationPresetSheet } from '@/components/shared/NotificationPresetSheet';

/** Preset por defecto al empezar a seguir (inicio, goles, tarjetas y final). */
const DEFAULT_PRESET = 'key_events';

/**
 * Estrella de favorito (equipos y ligas) con micro-interacción y toast.
 * Al marcar: relleno animado en color de acento + toast inferior temporal.
 * Área táctil mínima de 44px.
 */
export function FavoriteStar({ id, kind, name, className = '', variant = 'icon' }: {
  id: string;
  kind: 'team' | 'league' | 'player';
  /** Nombre para el toast ("Ahora sigues a Barça") */
  name?: string;
  className?: string;
  /** 'icon' = estrella sola · 'button' = pill "Seguir/Siguiendo" (cabeceras) */
  variant?: 'icon' | 'button';
}) {
  const {
    isFavorite, toggle, isLeagueFavorite, toggleLeague,
    isPlayerFavorite, togglePlayer, mounted,
  } = useFavorites();
  const { t } = useT();
  const [toast, setToast] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const active =
    kind === 'team' ? isFavorite(id)
    : kind === 'league' ? isLeagueFavorite(id)
    : isPlayerFavorite(id);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  if (!mounted) return <span className={`inline-block w-11 h-11 ${className}`} />;

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const wasActive = active;
    // #243: un ÚNICO evento canónico `favorite_added` (con `preset_selected`)
    // emitido por el hook. Antes la estrella emitía además `follow_created`
    // para la misma intención (doble conteo). El preset viaja en el propio
    // evento de favorito; ya no se emite nada desde aquí.
    const preset = wasActive ? undefined : DEFAULT_PRESET;
    if (kind === 'team') toggle(id, { preset });
    else if (kind === 'league') toggleLeague(id, { preset });
    else togglePlayer(id, name, { preset });
    setToast(t(wasActive ? 'favorites.toast_unfollowed' : 'favorites.toast_following', { name: name ?? '—' }));

    // Al EMPEZAR a seguir: preset por defecto 'key_events' (inicio, goles,
    // tarjetas y final; anti-ruido) y abrimos el selector para que el usuario
    // ajuste cuánto quiere recibir y pueda activar los avisos si aún no lo hizo.
    if (!wasActive) {
      setPreset(kind, id, DEFAULT_PRESET);
      void syncPushConfig();
      setSheetOpen(true);
    }

    // Trigger de conversión: al marcar el TERCER favorito en anónimo,
    // proponemos crear cuenta (el sheet decide si procede mostrarse)
    if (!wasActive) {
      try {
        const teams = JSON.parse(localStorage.getItem('rink-favorites') ?? '[]') as string[];
        const lgs = JSON.parse(localStorage.getItem('rink-fav-leagues') ?? '[]') as string[];
        // +1: el estado de localStorage puede ir un tick por detrás del toggle
        if (teams.length + lgs.length + 1 >= 3) {
          window.dispatchEvent(new Event('rink-auth-upsell'));
        }
      } catch { /* noop */ }
    }
  };

  // Variante botón: pill "Seguir / Siguiendo" para cabeceras (48px táctil)
  if (variant === 'button') {
    return (
      <>
        <button
          onClick={handleClick}
          aria-pressed={active}
          className={`inline-flex items-center gap-1.5 min-h-[48px] px-4 rounded-full text-sm font-semibold
                      transition-all duration-200 active:scale-95 ${
            active
              ? 'bg-rink-passion text-white'
              : 'border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
          } ${className}`}
        >
          <svg viewBox="0 0 24 24" fill={active ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={1.8}
               className="w-4 h-4">
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"
                  strokeLinejoin="round" />
          </svg>
          {active ? t('favorites.following') : t('favorites.follow')}
        </button>
        {toast && <FavToast text={toast} />}
        <NotificationPresetSheet open={sheetOpen} kind={kind} id={id} name={name} onClose={() => setSheetOpen(false)} />
      </>
    );
  }

  return (
    <>
      <button
        onClick={handleClick}
        aria-label={active ? 'Quitar de favoritos' : 'Añadir a favoritos'}
        aria-pressed={active}
        className={`inline-flex items-center justify-center w-11 h-11 -m-2 rounded-full
                    transition-transform active:scale-90 ${className}`}
      >
        <svg viewBox="0 0 24 24"
             fill={active ? 'currentColor' : 'none'}
             stroke="currentColor" strokeWidth={1.5}
             className={`w-5 h-5 transition-all duration-200 ease-out ${
               active
                 ? 'text-rink-passion scale-110 opacity-100'
                 : 'text-slate-300 dark:text-slate-600 opacity-80 hover:opacity-100 hover:text-slate-400'
             }`}>
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"
                strokeLinejoin="round" />
        </svg>
      </button>

      {toast && <FavToast text={toast} />}
      <NotificationPresetSheet open={sheetOpen} kind={kind} id={id} name={name} onClose={() => setSheetOpen(false)} />
    </>
  );
}

/** Toast inferior temporal (2 s) */
function FavToast({ text }: { text: string }) {
  return (
    <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[60]
                    flex items-center gap-2 px-4 py-2.5 rounded-full
                    bg-slate-900/95 dark:bg-slate-100/95 shadow-lg
                    text-xs font-medium text-white dark:text-slate-900
                    animate-[fadeIn_.15s_ease-out] whitespace-nowrap"
         role="status">
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5 text-rink-passion">
        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
      </svg>
      {text}
    </div>
  );
}
