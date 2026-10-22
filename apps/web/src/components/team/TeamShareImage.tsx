'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale, useT } from '@/lib/i18n';
import { track } from '@/lib/analytics';

type Format = 'story' | 'post';
type Theme = 'dark' | 'light';

/**
 * Botón + modal para compartir la ficha de un equipo como imagen (historia 9:16
 * o publicación 16:9, oscuro/claro). La imagen la genera el servidor
 * (teams/[id]/share-image); aquí se pre-descarga para que navigator.share se
 * llame dentro del gesto del usuario (iOS).
 */
export function TeamShareImage({ teamId, teamName }: { teamId: string; teamName: string }) {
  const { t } = useT();
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<Format>('story');
  const [theme, setTheme] = useState<Theme>('dark');
  const [loading, setLoading] = useState(true);
  const fileRef = useRef<File | null>(null);
  const src = `/${locale}/teams/${teamId}/share-image?format=${format}&theme=${theme}`;
  const fileName = `stick-live-${teamName.toLowerCase().replace(/[^a-z0-9]+/gi, '-')}-${format}.png`;

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
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const download = async () => {
    const file = fileRef.current ?? (await fetchFile());
    track('team_image_shared', { team_id: teamId, format, theme, outcome: 'download' });
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
      track('team_image_shared', { team_id: teamId, format, theme, outcome: 'shared' });
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
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t('team_share.title')}
        className="inline-flex items-center gap-1.5 rounded-full p-2 sm:border sm:border-slate-200 sm:px-3 sm:py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 sm:dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
      >
        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="9" cy="9" r="2" /><path d="m21 15-5-5L5 21" />
        </svg>
        <span className="hidden sm:inline">{t('team_share.button')}</span>
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center" onClick={() => setOpen(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t('team_share.title')}
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-[92vh] w-full max-w-md flex-col gap-4 rounded-t-2xl bg-white p-5 dark:bg-slate-900 sm:rounded-2xl"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">{t('team_share.title')}</h2>
              <button type="button" onClick={() => setOpen(false)} aria-label={t('team_share.close')} className="text-2xl leading-none text-slate-400">×</button>
            </div>

            <div className="flex gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800" role="group" aria-label={t('team_share.format')}>
              <button type="button" className={seg(format === 'story')} aria-pressed={format === 'story'} onClick={() => setFormat('story')}>{t('team_share.story')}</button>
              <button type="button" className={seg(format === 'post')} aria-pressed={format === 'post'} onClick={() => setFormat('post')}>{t('team_share.post')}</button>
            </div>
            <div className="flex gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800" role="group" aria-label={t('team_share.theme')}>
              <button type="button" className={seg(theme === 'dark')} aria-pressed={theme === 'dark'} onClick={() => setTheme('dark')}>{t('team_share.dark')}</button>
              <button type="button" className={seg(theme === 'light')} aria-pressed={theme === 'light'} onClick={() => setTheme('light')}>{t('team_share.light')}</button>
            </div>

            <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-xl bg-slate-100 p-2 dark:bg-slate-800">
              {/* eslint-disable-next-line @next/next/no-img-element -- PNG dinámico del servidor */}
              <img
                key={src}
                src={src}
                alt={t('team_share.preview', { team: teamName })}
                onLoad={() => setLoading(false)}
                className={`max-h-[50vh] w-auto rounded-lg object-contain transition-opacity ${loading ? 'opacity-40' : 'opacity-100'}`}
              />
            </div>

            <div className="flex gap-2">
              <button type="button" onClick={() => void download()} className="flex-1 rounded-full border border-slate-300 px-4 py-2.5 font-semibold text-slate-800 dark:border-slate-600 dark:text-slate-100">
                {t('team_share.download')}
              </button>
              {canNativeShare ? (
                <button type="button" onClick={share} className="flex-1 rounded-full bg-[#9E1235] px-4 py-2.5 font-semibold text-white">
                  {t('team_share.share')}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
