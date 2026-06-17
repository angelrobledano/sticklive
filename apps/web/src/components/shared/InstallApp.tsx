'use client';

import { useEffect, useState } from 'react';
import { useT } from '@/lib/i18n';
import { isIOS, isStandalone } from '@/lib/push';
import { canInstall, promptInstall } from '@/lib/pwa';

/**
 * Tarjeta "Instalar app". Usa el diálogo nativo en Chrome/Edge/Android; en
 * iPhone (sin soporte del evento) despliega instrucciones manuales. Se oculta
 * si la app ya está instalada (modo standalone) o si no hay forma de instalar.
 */
export function InstallApp() {
  const { t } = useT();
  const [mounted, setMounted] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [ios, setIos] = useState(false);
  const [hasPrompt, setHasPrompt] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    setMounted(true);
    setIos(isIOS());
    setInstalled(isStandalone());
    setHasPrompt(canInstall());
    const onInstallable = () => setHasPrompt(true);
    const onInstalled = () => setInstalled(true);
    window.addEventListener('pwa-installable', onInstallable);
    window.addEventListener('pwa-installed', onInstalled);
    return () => {
      window.removeEventListener('pwa-installable', onInstallable);
      window.removeEventListener('pwa-installed', onInstalled);
    };
  }, []);

  if (!mounted || installed) return null;
  // Sin prompt nativo y no es iOS (p. ej. Firefox de escritorio) → nada que ofrecer.
  if (!hasPrompt && !ios) return null;

  const onClick = async () => {
    if (hasPrompt) await promptInstall();
    else setShowHelp((v) => !v);
  };

  return (
    <div className="card p-4 border border-rink-passion/20 bg-rink-passion/[0.03] space-y-3">
      <button onClick={onClick} className="w-full flex items-center gap-3 text-left">
        <div className="w-10 h-10 rounded-full bg-rink-passion/10 flex items-center justify-center shrink-0">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5 text-rink-passion">
            <path d="M12 3v12m0 0l-4-4m4 4l4-4" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" strokeLinecap="round" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-900 dark:text-slate-50">{t('settings.install_app')}</p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
            {t('settings.install_app_desc')}
          </p>
        </div>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
             className={`w-4 h-4 text-slate-300 shrink-0 transition-transform ${ios && showHelp ? 'rotate-90' : ''}`}>
          <path d="M9 18l6-6-6-6" strokeLinecap="round" />
        </svg>
      </button>

      {ios && !hasPrompt && showHelp && (
        <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed bg-white dark:bg-slate-900 rounded-lg p-3">
          {t('settings.install_ios_help')}
        </p>
      )}
    </div>
  );
}
