'use client';

import { useEffect, useRef, useState } from 'react';
import { useT } from '@/lib/i18n';
import { tt } from '@/components/search/translate';
import { track } from '@/lib/analytics';
import {
  enablePush, isIOS, isStandalone, notificationPermission, pushOfferMode, pushSupported, vapidMissing,
  type PushOfferMode,
} from '@/lib/push';

/**
 * Oferta de avisos tras seguir algo (04/11/2026). Antes solo la mostraba la
 * hoja de presets de la estrella y, en iPhone sin instalar, desaparecía sin
 * explicar nada: 0 `push_subscribed` en 60 días. Ahora la usan la hoja y
 * Favoritos, y se mide:
 *   push_offer_shown  {source, mode}
 *   push_offer_result {source, result: granted|denied|error}
 */
export function PushOfferCard({ source, onDone, onDismiss }: {
  /** Dónde aparece: preset_sheet | favorites. */
  source: string;
  /** Tras contestar al permiso (concedido o no). */
  onDone?: () => void;
  /** Si se pasa, muestra «Ahora no». */
  onDismiss?: () => void;
}) {
  const { t } = useT();
  const [mode, setMode] = useState<PushOfferMode>('none');
  const [busy, setBusy] = useState(false);
  const shown = useRef(false);

  useEffect(() => {
    const m = pushOfferMode({
      supported: pushSupported(),
      permission: notificationPermission(),
      vapidMissing: vapidMissing(),
      ios: isIOS(),
      standalone: isStandalone(),
    });
    setMode(m);
    if (m !== 'none' && !shown.current) {
      shown.current = true;
      track('push_offer_shown', { source, mode: m });
    }
  }, [source]);

  if (mode === 'none') return null;

  const activate = async () => {
    setBusy(true);
    const ok = await enablePush();
    const result = ok ? 'granted' : notificationPermission() === 'denied' ? 'denied' : 'error';
    track('push_offer_result', { source, result });
    setBusy(false);
    setMode('none');
    onDone?.();
  };

  return (
    <div className="flex items-start gap-3 rounded-2xl border border-rink-passion/30 bg-rink-passion/5 p-3 dark:border-rink-accent/30 dark:bg-rink-accent/10">
      <span aria-hidden="true" className="mt-0.5 text-rink-passion dark:text-rink-accent">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-5 w-5">
          <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" strokeLinecap="round" />
        </svg>
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-slate-900 dark:text-slate-50">
          {t('notif_presets.push_offer_title')}
        </p>
        {mode === 'activate' ? (
          <>
            <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-300">{t('notif_presets.push_offer_desc')}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button type="button" onClick={activate} disabled={busy}
                      className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-rink-passion px-3.5 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50">
                {busy && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden="true" />}
                {t('notif_presets.push_offer_cta')}
              </button>
              {onDismiss && (
                <button type="button" onClick={onDismiss}
                        className="min-h-[44px] px-2 text-xs font-semibold text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-50">
                  {tt(t, 'notif_presets.push_offer_later', 'Ahora no')}
                </button>
              )}
            </div>
          </>
        ) : (
          <>
            <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-300">
              {tt(t, 'notif_presets.push_offer_ios', 'En iPhone los avisos llegan con Stick Live en tu pantalla de inicio. Pulsa Compartir y después «Añadir a pantalla de inicio», abre la app desde ahí y actívalos.')}
            </p>
            {onDismiss && (
              <button type="button" onClick={onDismiss}
                      className="mt-1 min-h-[44px] text-xs font-semibold text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-50">
                {tt(t, 'notif_presets.push_offer_later', 'Ahora no')}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
