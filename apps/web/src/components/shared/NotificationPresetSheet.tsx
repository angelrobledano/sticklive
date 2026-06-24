'use client';

import { useEffect, useState } from 'react';
import { useT } from '@/lib/i18n';
import { track } from '@/lib/analytics';
import { getPreset, setPreset, type NotificationPreset } from '@/lib/notif-prefs';
import { syncPushConfig } from '@/lib/push';

type Kind = 'team' | 'league' | 'player';

const ORDER: NotificationPreset[] = ['complete', 'key_events', 'results', 'silent'];

/** Icono por preset (trazo simple, hereda color del texto). */
function PresetIcon({ preset }: { preset: NotificationPreset }) {
  const common = 'w-5 h-5 shrink-0';
  switch (preset) {
    case 'complete':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className={common}>
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M13.7 21a2 2 0 0 1-3.4 0" strokeLinecap="round" />
        </svg>
      );
    case 'key_events':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className={common}>
          <path d="M13 2L3 14h7l-1 8 10-12h-7l1-8z" strokeLinejoin="round" />
        </svg>
      );
    case 'results':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className={common}>
          <path d="M4 7h16M4 12h16M4 17h10" strokeLinecap="round" />
        </svg>
      );
    case 'silent':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className={common}>
          <path d="M18 8A6 6 0 0 0 8.7 3.3M6 8c0 7-3 9-3 9h13" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M13.7 21a2 2 0 0 1-3.4 0" strokeLinecap="round" />
          <path d="M2 2l20 20" strokeLinecap="round" />
        </svg>
      );
  }
}

/**
 * Selector de nivel de notificación para una entidad seguida (preset).
 * Bottom sheet en móvil / diálogo centrado en pantallas anchas. Al elegir,
 * persiste el preset, sincroniza con el backend y cierra.
 */
export function NotificationPresetSheet({ open, kind, id, name, onClose }: {
  open: boolean;
  kind: Kind;
  id: string;
  name?: string;
  onClose: () => void;
}) {
  const { t } = useT();
  const [selected, setSelected] = useState<NotificationPreset>('key_events');

  useEffect(() => {
    if (open) setSelected(getPreset(kind, id));
  }, [open, kind, id]);

  // Cierra con Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const entityType = kind === 'league' ? 'competition' : kind;

  const choose = (preset: NotificationPreset) => {
    const previous = getPreset(kind, id);
    setSelected(preset);
    setPreset(kind, id, preset);
    void syncPushConfig();
    if (preset !== previous) {
      track('notification_preset_changed', {
        entity_type: entityType, entity_id: id,
        previous_preset: previous, new_preset: preset,
      });
    }
    onClose();
  };

  return (
    <div role="dialog" aria-modal="true" aria-label={t('notif_presets.title')}
         className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40 animate-[fadeIn_.15s_ease-out]" onClick={onClose} />

      <div className="relative w-full sm:max-w-md bg-white dark:bg-slate-900 shadow-2xl
                      rounded-t-3xl sm:rounded-3xl p-5 pb-7 sm:pb-5
                      animate-[fadeIn_.18s_ease-out] max-h-[85vh] overflow-y-auto">
        {/* Asa de bottom sheet (solo móvil) */}
        <div className="sm:hidden mx-auto mb-4 h-1.5 w-10 rounded-full bg-slate-200 dark:bg-slate-700" />

        <h2 className="text-base font-bold text-slate-900 dark:text-slate-50">
          {t('notif_presets.title')}
        </h2>
        {name && (
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5 mb-3 truncate">{name}</p>
        )}

        <div className="space-y-2 mt-3">
          {ORDER.map((p) => {
            const active = selected === p;
            return (
              <button
                key={p}
                onClick={() => choose(p)}
                aria-pressed={active}
                className={`w-full text-left flex items-start gap-3 p-3 rounded-2xl border transition-colors
                            min-h-[44px] ${
                  active
                    ? 'border-rink-passion bg-rink-passion/5 text-rink-passion'
                    : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/60'
                }`}
              >
                <span className={`mt-0.5 ${active ? 'text-rink-passion' : 'text-slate-400 dark:text-slate-500'}`}>
                  <PresetIcon preset={p} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">{t(`notif_presets.${p}.label`)}</span>
                  <span className={`block text-xs mt-0.5 ${active ? 'text-rink-passion/80' : 'text-slate-500 dark:text-slate-400'}`}>
                    {t(`notif_presets.${p}.desc`)}
                  </span>
                </span>
                {active && (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}
                       className="w-5 h-5 shrink-0 mt-0.5">
                    <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
