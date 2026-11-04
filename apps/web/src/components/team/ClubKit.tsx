'use client';

import { useState } from 'react';
import { useLocale, useT } from '@/lib/i18n';
import { tt } from '@/components/search/translate';
import { track } from '@/lib/analytics';
import { ShareImageDialog } from '@/components/shared/ShareImageButton';

/** Código del iframe para la web del club (04/11/2026). */
export function embedCode(siteUrl: string, locale: string, teamId: string, teamName: string): string {
  const src = `${siteUrl}/${locale}/embed/team/${teamId}`;
  const title = teamName.replace(/"/g, '&quot;');
  return `<iframe src="${src}" title="${title} · Stick Live" width="100%" height="560" style="border:0;max-width:420px" loading="lazy"></iframe>`;
}

/**
 * «Para el club» (04/11/2026): distribución a través de los clubes, que ya
 * publican sus resultados a mano. Imagen del último resultado (el diálogo de
 * siempre) y widget para su web. Plegado: no estorba al aficionado.
 */
export function ClubKit({ siteUrl, teamId, teamName, lastMatch }: {
  siteUrl: string;
  teamId: string;
  teamName: string;
  lastMatch: { id: string; label: string } | null;
}) {
  const { t } = useT();
  const locale = useLocale();
  const [imageOpen, setImageOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const code = embedCode(siteUrl, locale, teamId, teamName);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* el textarea permite copiarlo a mano */ }
    track('embed_code_copied', { team_id: teamId });
  };

  return (
    <details className="card group p-5"
             onToggle={(e) => { if ((e.currentTarget as HTMLDetailsElement).open) track('club_kit_opened', { team_id: teamId }); }}>
      <summary className="flex min-h-[44px] cursor-pointer list-none items-center justify-between text-sm font-semibold text-slate-700 dark:text-slate-300">
        {tt(t, 'club_kit.title', '¿Llevas la web o las redes del club?')}
        <span aria-hidden="true" className="text-slate-400 transition-transform group-open:rotate-180">▾</span>
      </summary>

      <div className="mt-3 space-y-5">
        {lastMatch && (
          <div>
            <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">{tt(t, 'club_kit.image_title', 'Imagen del último resultado')}</p>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{tt(t, 'club_kit.image_body', 'Lista para Instagram, en formato historia o publicación.')}</p>
            <button type="button" onClick={() => setImageOpen(true)}
                    className="mt-2 inline-flex min-h-[44px] items-center rounded-xl border border-slate-200 px-3.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">
              {lastMatch.label}
            </button>
            <ShareImageDialog imagePath={`/matches/${lastMatch.id}/share-image`} name={lastMatch.label}
                              kind="match" entityId={lastMatch.id} open={imageOpen} onClose={() => setImageOpen(false)} />
          </div>
        )}

        <div>
          <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">{tt(t, 'club_kit.embed_title', 'Resultados y clasificación en tu web')}</p>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            {tt(t, 'club_kit.embed_body', 'Pega este código en tu web. Se actualiza solo con el próximo partido, los últimos resultados y la clasificación.')}
          </p>
          <textarea readOnly value={code} rows={3} aria-label={tt(t, 'club_kit.embed_title', 'Resultados y clasificación en tu web')}
                    onFocus={(e) => e.currentTarget.select()}
                    className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 p-2 font-mono text-[11px] text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200" />
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <button type="button" onClick={copy}
                    className="inline-flex min-h-[44px] items-center rounded-xl bg-rink-passion px-3.5 text-xs font-semibold text-white hover:opacity-90">
              {copied ? tt(t, 'club_kit.copied', 'Copiado') : tt(t, 'club_kit.copy', 'Copiar código')}
            </button>
            <a href={`/${locale}/embed/team/${teamId}`} target="_blank" rel="noopener"
               className="min-h-[44px] inline-flex items-center text-xs font-semibold text-rink-passion hover:underline dark:text-rink-accent">
              {tt(t, 'club_kit.preview', 'Ver cómo queda')} →
            </a>
          </div>
        </div>
      </div>
    </details>
  );
}
