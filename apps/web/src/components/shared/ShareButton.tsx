'use client';

/**
 * Botón de compartir universal (partido, equipo, liga, jugador).
 * Web Share API nativa en móvil; fallback: copiar enlace + feedback "Copiado".
 */
import { useState } from 'react';
import { useT } from '@/lib/i18n';
import { track } from '@/lib/analytics';

export function ShareButton({ title, kind, className = '' }: {
  title: string;
  /** Para analítica: match | team | league | player */
  kind: string;
  className?: string;
}) {
  const { t } = useT();
  const [copied, setCopied] = useState(false);

  const share = async () => {
    const url = window.location.href;
    track('share', { kind, title });
    try {
      if (navigator.share) {
        await navigator.share({ title: `${title} · Stick Live`, url });
        return;
      }
    } catch { /* cancelado por el usuario */ return; }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* noop */ }
  };

  return (
    <button
      onClick={share}
      aria-label={t('common.share')}
      className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0
                  text-slate-400 hover:text-rink-passion hover:bg-slate-100 dark:hover:bg-slate-800
                  transition-colors ${className}`}
    >
      {copied ? (
        <span className="text-[9px] font-bold text-emerald-500">{t('common.copied')}</span>
      ) : (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-[18px] h-[18px]">
          <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
          <path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" />
        </svg>
      )}
    </button>
  );
}
