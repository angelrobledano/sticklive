'use client';

/**
 * Un solo "Compartir" para fichas (equipo, partido, jugador). Abre una hoja con
 * dos caminos claros: la imagen para redes (historia o publicación, lo que más
 * se comparte en Instagram y WhatsApp) y el enlace. Sustituye a los iconos
 * sueltos (imagen + compartir) que se montaban sobre el título.
 */
import { useEffect, useState } from 'react';
import { useT } from '@/lib/i18n';
import { track } from '@/lib/analytics';
import { buildShareUrl } from '@/lib/share';
import { ShareImageDialog } from './ShareImageButton';

export function ShareSheet({
  kind, entityId, name, title, imagePath, className = '', compact = false,
}: {
  kind: 'team' | 'match' | 'player';
  entityId: string;
  /** Para el fichero de la imagen. */
  name: string;
  /** Texto del enlace compartido ("Barça 4-2 Liceo"). */
  title: string;
  /** Sin prefijo de idioma, p. ej. `/teams/{id}/share-image`. */
  imagePath: string;
  className?: string;
  /** Solo icono (cabecera del partido, donde no hay fila de acciones). */
  compact?: boolean;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [imageOpen, setImageOpen] = useState(false);
  const [linkStatus, setLinkStatus] = useState<'idle' | 'copied' | 'error'>('idle');

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const shareLink = async () => {
    // #282: compartir el recurso, no la URL de tracking.
    const url = buildShareUrl(window.location.href);
    track('share', { kind, title });
    if (navigator.share) {
      try {
        await navigator.share({ title: `${title} · Stick Live`, url });
        setOpen(false);
        return;
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setLinkStatus('copied');
    } catch {
      setLinkStatus('error');
    }
    setTimeout(() => setLinkStatus('idle'), 2000);
  };

  const option = 'flex w-full items-center gap-4 rounded-2xl p-3 text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-800';

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t('share_sheet.button')}
        className={`inline-flex h-10 items-center gap-2 rounded-full text-sm font-semibold transition-colors hover:text-rink-passion ${
          compact ? 'w-10 justify-center text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
            : 'border border-slate-200 px-4 text-slate-700 hover:border-rink-passion dark:border-slate-700 dark:text-slate-200'
        } ${className}`}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
          <path d="M12 3v12M7 8l5-5 5 5M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5" />
        </svg>
        {!compact && t('share_sheet.button')}
      </button>

      {open && (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/50 sm:items-center" onClick={() => setOpen(false)}>
          <div
            role="dialog" aria-modal="true" aria-label={t('share_sheet.title')}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm space-y-1 rounded-t-3xl bg-white p-4 pb-6 dark:bg-slate-900 sm:rounded-3xl"
          >
            <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-slate-200 dark:bg-slate-700 sm:hidden" aria-hidden="true" />
            <p className="px-3 pb-1 text-base font-bold text-slate-900 dark:text-slate-50">{t('share_sheet.title')}</p>

            <button type="button" className={option} onClick={() => { setOpen(false); setImageOpen(true); }}>
              {/* Degradado cálido de "historias": reconocible para redes sin usar el logo de nadie. */}
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-tr from-amber-400 via-rose-500 to-fuchsia-600 text-white shadow-md">
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
                  <rect x="6" y="2.5" width="12" height="19" rx="3" /><circle cx="12" cy="10" r="2.5" /><path d="M8.5 17c.8-1.6 2-2.4 3.5-2.4s2.7.8 3.5 2.4" />
                </svg>
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-bold text-slate-900 dark:text-slate-50">{t('share_sheet.image')}</span>
                <span className="block text-xs text-slate-500 dark:text-slate-400">{t('share_sheet.image_sub')}</span>
              </span>
            </button>

            <button type="button" className={option} onClick={() => void shareLink()}>
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
                  <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" /><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
                </svg>
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-bold text-slate-900 dark:text-slate-50">
                  {linkStatus === 'copied' ? t('common.copied') : linkStatus === 'error' ? t('common.copy_failed') : t('share_sheet.link')}
                </span>
                <span className="block text-xs text-slate-500 dark:text-slate-400">{t('share_sheet.link_sub')}</span>
              </span>
            </button>
          </div>
        </div>
      )}

      <ShareImageDialog imagePath={imagePath} name={name} kind={kind} entityId={entityId} open={imageOpen} onClose={() => setImageOpen(false)} />
    </>
  );
}
