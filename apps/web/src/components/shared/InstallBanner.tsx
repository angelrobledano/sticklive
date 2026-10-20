'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useT } from '@/lib/i18n';
import { tt } from '@/components/search/translate';
import { track, trackOnce } from '@/lib/analytics';
import { getAnalyticsConsentState, startConsentWatcher, subscribeAnalyticsConsent } from '@/lib/consent-tcf';
import { isStandalone } from '@/lib/push';
import { canInstall, promptInstall, pwaPlatform } from '@/lib/pwa';
import {
  shouldShowInstallBanner, readDismissedAt, writeDismissedAt, bumpPageViews,
} from '@/lib/install-prompt';

/**
 * Aviso inferior para instalar la PWA (Android e iPhone).
 *
 *  · Android: «Instalar» lanza el diálogo nativo del navegador.
 *  · iPhone: no hay diálogo; «Instalar» despliega los dos pasos (Compartir →
 *    Añadir a pantalla de inicio). En iPhone es además la única forma de
 *    recibir notificaciones push, y el mensaje lo dice.
 *
 * Cuándo sale lo decide `shouldShowInstallBanner` (lib/install-prompt).
 *
 * Analítica (docs/TRACKING_POSTHOG.md §3.3), embudo completo:
 *   install_banner_shown → install_cta_clicked → (Android) app_install_prompt_shown
 *   → app_install_prompt_result → app_installed  |  (iPhone) install_ios_steps_shown
 *   install_banner_dismissed en cualquier punto. app_opened_standalone mide el uso
 *   desde la app instalada.
 */
export function InstallBanner() {
  const { t } = useT();
  const pathname = usePathname();
  const [visible, setVisible] = useState(false);
  const [iosSteps, setIosSteps] = useState(false);
  const pageViews = useRef(0);

  const platform = typeof window === 'undefined' ? 'desktop' : pwaPlatform();
  const mode = platform === 'ios' ? 'ios_steps' : 'native';
  // Ruta sin el prefijo de idioma: en qué pantalla convierte mejor.
  const page = (pathname ?? '/').replace(/^\/(es|en|pt|fr|it)(?=\/|$)/, '') || '/';

  const evaluate = useCallback(() => {
    if (isStandalone()) {
      setVisible(false);
      return;
    }
    const show = shouldShowInstallBanner({
      platform: pwaPlatform(),
      standalone: false,
      hasNativePrompt: canInstall(),
      consent: getAnalyticsConsentState(),
      dismissedAt: readDismissedAt(),
      pageViews: pageViews.current,
      now: Date.now(),
    });
    setVisible(show);
  }, []);

  // Cada cambio de ruta cuenta como página vista de la sesión.
  useEffect(() => {
    pageViews.current = bumpPageViews();
    evaluate();
  }, [pathname, evaluate]);

  useEffect(() => {
    if (isStandalone()) trackOnce('app-opened-standalone', 'app_opened_standalone', { platform: pwaPlatform() });
    startConsentWatcher();
    const onChange = () => evaluate();
    const unsubscribe = subscribeAnalyticsConsent(onChange);
    window.addEventListener('pwa-installable', onChange);
    window.addEventListener('pwa-installed', onChange);
    return () => {
      unsubscribe();
      window.removeEventListener('pwa-installable', onChange);
      window.removeEventListener('pwa-installed', onChange);
    };
  }, [evaluate]);

  useEffect(() => {
    if (visible) trackOnce('install-banner-shown', 'install_banner_shown', { platform, mode, page });
  }, [visible, platform, mode, page]);

  if (!visible) return null;

  const dismiss = () => {
    writeDismissedAt(Date.now());
    track('install_banner_dismissed', { platform, mode, step: iosSteps ? 'ios_steps' : 'banner', page });
    setVisible(false);
  };

  const install = async () => {
    track('install_cta_clicked', { platform, source: 'banner', mode, page });
    if (platform === 'ios') {
      setIosSteps(true);
      track('install_ios_steps_shown', { platform, page });
      return;
    }
    const outcome = await promptInstall('banner');
    // Aceptado: `appinstalled` lo cierra. Rechazado en el diálogo nativo:
    // cuenta como «Ahora no» para no volver a insistir enseguida.
    if (outcome === 'dismissed') {
      writeDismissedAt(Date.now());
      setVisible(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-label={tt(t, 'install.aria', 'Instalar Stick Live')}
      className="fixed inset-x-0 bottom-20 z-[55] px-3 md:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="card mx-auto max-w-md p-4 shadow-xl ring-1 ring-slate-200 dark:ring-slate-700">
        <div className="flex items-start gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon-192.png" alt="" width={44} height={44} className="h-11 w-11 shrink-0 rounded-xl" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-slate-900 dark:text-slate-50">
              {tt(t, 'install.title', 'Los goles, en cuanto pasan')}
            </p>
            <p className="mt-0.5 text-xs leading-snug text-slate-600 dark:text-slate-300">
              {platform === 'ios'
                ? tt(t, 'install.body_ios', 'Añade Stick Live a tu pantalla de inicio: abre los directos en un toque y, en iPhone, es la única forma de recibir el aviso de cada gol.')
                : tt(t, 'install.body_android', 'Instala Stick Live: abre los directos en un toque y recibe un aviso con cada gol de tus equipos. Gratis y sin pasar por la tienda.')}
            </p>
          </div>
          <button
            type="button"
            onClick={dismiss}
            aria-label={tt(t, 'install.close', 'Cerrar')}
            className="-mr-2 -mt-2 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4" aria-hidden="true">
              <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {iosSteps ? (
          <div className="mt-3 rounded-xl bg-slate-50 p-3 dark:bg-slate-800/60" role="status">
            <p className="text-xs font-bold text-slate-900 dark:text-slate-50">
              {tt(t, 'install.ios_steps_title', 'Instálala en dos toques')}
            </p>
            <ol className="mt-2 space-y-2 text-xs text-slate-700 dark:text-slate-200">
              <li className="flex items-start gap-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-rink-passion text-[10px] font-bold text-white">1</span>
                <span className="flex-1">
                  {tt(t, 'install.ios_step1', 'Toca el botón Compartir (el cuadrado con la flecha hacia arriba).')}
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true"
                       className="ml-1 inline h-4 w-4 align-[-3px] text-sky-600 dark:text-sky-400">
                    <path d="M12 3v12M8 7l4-4 4 4" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1" strokeLinecap="round" />
                  </svg>
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-rink-passion text-[10px] font-bold text-white">2</span>
                <span className="flex-1">{tt(t, 'install.ios_step2', 'Elige «Añadir a pantalla de inicio» y toca «Añadir».')}</span>
              </li>
            </ol>
          </div>
        ) : (
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={dismiss}
              className="min-h-[44px] flex-1 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 dark:border-slate-700 dark:text-slate-300"
            >
              {tt(t, 'install.later', 'Ahora no')}
            </button>
            <button
              type="button"
              onClick={() => { void install(); }}
              className="min-h-[44px] flex-[1.4] rounded-xl bg-rink-passion text-sm font-semibold text-white hover:bg-rink-passion-light active:bg-rink-passion-dark"
            >
              {tt(t, 'install.cta', 'Instalar')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
