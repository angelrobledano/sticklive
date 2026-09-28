'use client';

/**
 * Botón de compartir universal (partido, equipo, liga, jugador).
 * Web Share API nativa en móvil; fallback: copiar enlace + feedback "Copiado".
 */
import { useEffect, useRef, useState } from 'react';
import { useT } from '@/lib/i18n';
import { track } from '@/lib/analytics';
import { buildShareUrl } from '@/lib/share';

type ShareStatus = 'idle' | 'copied' | 'error';

export function ShareButton({ title, kind, className = '' }: {
  title: string;
  /** Para analítica: match | team | league | player */
  kind: string;
  className?: string;
}) {
  const { t } = useT();
  const [status, setStatus] = useState<ShareStatus>('idle');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // No dejar timers vivos si el componente se desmonta antes del reset.
  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const flash = (next: Exclude<ShareStatus, 'idle'>) => {
    setStatus(next);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setStatus('idle'), 2000);
  };

  const share = async () => {
    // #282: compartir el recurso, no la URL de tracking (?src=push, utm…).
    const url = buildShareUrl(window.location.href);
    track('share', { kind, title });
    // Web Share API (móvil). En PC suele no existir o fallar; en ese caso NO
    // abortamos: caemos a copiar el enlace. Solo el cancelar del usuario corta.
    if (navigator.share) {
      try {
        await navigator.share({ title: `${title} · Stick Live`, url });
        return;
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return; // el usuario canceló
        // cualquier otro error (PC sin soporte real, etc.) → copiar enlace
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      flash('copied');
    } catch {
      // #281: sin permiso/contexto seguro o WebView no hay copia; avisar en vez
      // de dejar un no-op silencioso que simula un "compartido" inexistente.
      flash('error');
    }
  };

  return (
    <button
      onClick={share}
      aria-label={t('common.share')}
      className={`h-11 rounded-full flex items-center justify-center shrink-0
                  ${status === 'error' ? 'w-auto px-2' : 'w-11'}
                  text-slate-400 hover:text-rink-passion hover:bg-slate-100 dark:hover:bg-slate-800
                  transition-colors ${className}`}
    >
      {status === 'copied' ? (
        <span className="text-[10px] font-bold text-emerald-500">{t('common.copied')}</span>
      ) : status === 'error' ? (
        <span role="status" className="text-[10px] font-bold text-red-500 whitespace-nowrap">
          {t('common.copy_failed')}
        </span>
      ) : (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-[18px] h-[18px]">
          <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
          <path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" />
        </svg>
      )}
    </button>
  );
}
