'use client';

import { useEffect, useState } from 'react';
import { useT } from '@/lib/i18n';
import { isIOS, isStandalone } from '@/lib/push';
import { canInstall, promptInstall, pwaPlatform } from '@/lib/pwa';
import { track } from '@/lib/analytics';

/**
 * Fila "Instalar app". Usa el diálogo nativo en Chrome/Edge/Android cuando está
 * disponible. Si el navegador no expone `beforeinstallprompt` (iOS, Firefox,
 * Safari de escritorio…), despliega instrucciones manuales. Solo se oculta si
 * la app ya está abierta en modo standalone.
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

  const onClick = async () => {
    track('install_cta_clicked', {
      platform: pwaPlatform(),
      source: 'settings',
      mode: hasPrompt ? 'native' : ios ? 'ios_steps' : 'manual_steps',
    });
    if (hasPrompt) await promptInstall('settings');
    else setShowHelp((v) => !v);
  };

  return (
    <div className="py-1">
      <button type="button" onClick={onClick} className="w-full flex items-center gap-3 py-2.5 text-left min-h-[56px]">
        <div className="w-9 h-9 rounded-full bg-rink-passion/10 flex items-center justify-center shrink-0">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-[18px] h-[18px] text-rink-passion dark:text-rink-accent">
            <path d="M12 3v12m0 0l-4-4m4 4l4-4" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" strokeLinecap="round" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-slate-800 dark:text-slate-200">{t('settings.install_app')}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400 leading-snug mt-0.5">
            {t('settings.install_app_desc')}
          </p>
        </div>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
             className={`w-4 h-4 text-slate-300 dark:text-slate-600 shrink-0 transition-transform ${showHelp ? 'rotate-90' : ''}`}>
          <path d="M9 18l6-6-6-6" strokeLinecap="round" />
        </svg>
      </button>

      {!hasPrompt && showHelp && (
        <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed bg-slate-50 dark:bg-slate-800/60 rounded-lg p-3 mb-2">
          {ios ? t('settings.install_ios_help') : t('settings.install_help')}
        </p>
      )}
    </div>
  );
}
