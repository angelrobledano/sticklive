'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale, useT } from '@/lib/i18n';
import { track } from '@/lib/analytics';

type Format = 'story' | 'post';
type Theme = 'dark' | 'light';

/**
 * Botón + modal para compartir una ficha como imagen (historia 9:16 o
 * publicación 16:9, oscuro/claro). La imagen la genera el servidor en
 * `imagePath` (?format=&theme=); aquí se pre-descarga para que navigator.share
 * se llame dentro del gesto del usuario (iOS). Lo usan equipo y partido.
 */
export function ShareImageDialog({
  imagePath, name, kind, entityId, open, onClose,
}: {
  /** Sin prefijo de idioma, p. ej. `/teams/{id}/share-image`. */
  imagePath: string;
  /** Para el nombre del fichero y el alt de la vista previa. */
  name: string;
  kind: 'team' | 'match' | 'player';
  entityId: string;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useT();
  const locale = useLocale();
  const [format, setFormat] = useState<Format>('story');
  const [theme, setTheme] = useState<Theme>('dark');
  const [loading, setLoading] = useState(true);
  const fileRef = useRef<File | null>(null);
  const src = `/${locale}${imagePath}?format=${format}&theme=${theme}`;
  const fileName = `stick-live-${name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/gi, '-')}-${format}.png`;

  const fetchFile = useCallback(async () => {
    try {
      const res = await fetch(src);
      if (!res.ok) return null;
      const file = new File([await res.blob()], fileName, { type: 'image/png' });
      fileRef.current = file;
      return file;
    } catch {
      return null;
    }
  }, [src, fileName]);

  useEffect(() => {
    if (!open) return;
    fileRef.current = null;
    setLoading(true);
    let cancelled = false;
    void fetchFile().then(() => { if (cancelled) fileRef.current = null; });
    return () => { cancelled = true; };
  }, [open, fetchFile]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const download = async () => {
    const file = fileRef.current ?? (await fetchFile());
    track('image_shared', { kind, id: entityId, format, theme, outcome: 'download' });
    if (!file) { window.open(src, '_blank'); return; }
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const share = () => {
    const file = fileRef.current;
    if (file && navigator.canShare?.({ files: [file] })) {
      track('image_shared', { kind, id: entityId, format, theme, outcome: 'shared' });
      navigator.share({ files: [file], title: 'Stick Live' }).catch(() => {});
      return;
    }
    void download();
  };

  const canNativeShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  const seg = (active: boolean) =>
    `flex-1 rounded-md px-3 py-1.5 text-sm font-semibold transition ${
      active ? 'bg-white text-slate-900 shadow dark:bg-slate-700 dark:text-white' : 'text-slate-500 dark:text-slate-400'
    }`;

  return (
    <>
      {open ? (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/60 sm:items-center" onClick={() => onClose()}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t(kind === 'match' ? 'share_image.title_match' : kind === 'player' ? 'share_image.title_player' : 'share_image.title')}
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-[92vh] w-full max-w-md flex-col gap-4 rounded-t-2xl bg-white p-5 dark:bg-slate-900 sm:rounded-2xl"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">{t(kind === 'match' ? 'share_image.title_match' : kind === 'player' ? 'share_image.title_player' : 'share_image.title')}</h2>
              <button type="button" onClick={() => onClose()} aria-label={t('share_image.close')} className="text-2xl leading-none text-slate-400">×</button>
            </div>

            <div className="flex gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800" role="group" aria-label={t('share_image.format')}>
              <button type="button" className={seg(format === 'story')} aria-pressed={format === 'story'} onClick={() => setFormat('story')}>{t('share_image.story')}</button>
              <button type="button" className={seg(format === 'post')} aria-pressed={format === 'post'} onClick={() => setFormat('post')}>{t('share_image.post')}</button>
            </div>
            <div className="flex gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800" role="group" aria-label={t('share_image.theme')}>
              <button type="button" className={seg(theme === 'dark')} aria-pressed={theme === 'dark'} onClick={() => setTheme('dark')}>{t('share_image.dark')}</button>
              <button type="button" className={seg(theme === 'light')} aria-pressed={theme === 'light'} onClick={() => setTheme('light')}>{t('share_image.light')}</button>
            </div>

            <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-xl bg-slate-100 p-2 dark:bg-slate-800">
              {/* eslint-disable-next-line @next/next/no-img-element -- PNG dinámico del servidor */}
              <img
                key={src}
                src={src}
                alt={t('share_image.preview', { name })}
                onLoad={() => setLoading(false)}
                className={`max-h-[50vh] w-auto rounded-lg object-contain transition-opacity ${loading ? 'opacity-40' : 'opacity-100'}`}
              />
            </div>

            <div className="flex gap-2">
              <button type="button" onClick={() => void download()} className="flex-1 rounded-full border border-slate-300 px-4 py-2.5 font-semibold text-slate-800 dark:border-slate-600 dark:text-slate-100">
                {t('share_image.download')}
              </button>
              {canNativeShare ? (
                <button type="button" onClick={share} className="flex-1 rounded-full bg-[#9E1235] px-4 py-2.5 font-semibold text-white">
                  {t('share_image.share')}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

/** Botón suelto que abre el diálogo (se mantiene para usos fuera de la cabecera). */
export function ShareImageButton(props: Omit<Parameters<typeof ShareImageDialog>[0], 'open' | 'onClose'>) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="inline-flex h-11 w-11 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 hover:text-rink-passion dark:text-slate-400 dark:hover:bg-slate-800" aria-label="Imagen">
        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="9" cy="9" r="2" /><path d="m21 15-5-5L5 21" />
        </svg>
      </button>
      <ShareImageDialog {...props} open={open} onClose={() => setOpen(false)} />
    </>
  );
}
