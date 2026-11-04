'use client';

import { PushOfferCard } from '@/components/shared/PushOfferCard';
import { useEffect, useRef, useState } from 'react';
import { useT } from '@/lib/i18n';
import { track } from '@/lib/analytics';
import { getPreset, setPreset, uiPreset, presetsFor, type NotificationPreset } from '@/lib/notif-prefs';
import { syncPushConfig } from '@/lib/push';

type Kind = 'team' | 'league' | 'player';

/**
 * Clave i18n de la descripción de cada opción. Un jugador tiene copy propia en
 * las opciones que le aplican ("sus goles/tarjetas"), porque la genérica nombra
 * el inicio y el resultado final del partido, que no le llegan.
 */
function descKey(kind: Kind, p: NotificationPreset): string {
  return kind === 'player' && p !== 'results'
    ? `notif_presets.player.${p}.desc`
    : `notif_presets.${p}.desc`;
}

/** Selector de elementos tabulables dentro de un diálogo modal. */
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * #359: índice destino al tabular dentro de un diálogo (trap de foco). Pura para
 * poder fijarla sin navegador: envuelve el final→principio y viceversa.
 */
export function trapFocusIndex(current: number, count: number, backwards: boolean): number {
  if (count <= 0) return -1;
  if (current < 0) return backwards ? count - 1 : 0;
  return backwards ? (current - 1 + count) % count : (current + 1) % count;
}

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
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  // `onClose` llega como arrow inline desde los padres (nueva identidad en cada
  // render); lo leemos por ref para que el efecto de foco no se re-ejecute.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    // Normaliza al repertorio del tipo: un jugador con "Resultados" guardado (ya
    // no ofrecido) cae a "Eventos clave" para que siempre haya opción marcada.
    const raw = uiPreset(getPreset(kind, id));
    setSelected(presetsFor(kind).includes(raw) ? raw : 'key_events');
  }, [open, kind, id]);

  // #359: foco inicial al primer control, trap de Tab y restauración al cerrar
  // (además de Escape y bloqueo del scroll de fondo).
  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = (document.activeElement as HTMLElement | null) ?? null;

    const focusables = (): HTMLElement[] => {
      const root = dialogRef.current;
      return root ? Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)) : [];
    };
    (focusables()[0] ?? dialogRef.current)?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onCloseRef.current(); return; }
      if (e.key !== 'Tab') return;
      const list = focusables();
      if (list.length === 0) return;
      const active = document.activeElement as HTMLElement | null;
      const current = active ? list.indexOf(active) : -1;
      if (current === -1) { e.preventDefault(); list[0]!.focus(); return; }
      const target = trapFocusIndex(current, list.length, e.shiftKey);
      if (target !== current) { e.preventDefault(); list[target]!.focus(); }
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      previouslyFocused.current?.focus?.();
    };
    // Solo al abrir/cerrar: `onClose` se lee por ref.
  }, [open]);

  if (!open) return null;

  const entityType = kind === 'league' ? 'competition' : kind;
  const options = presetsFor(kind);

  const choose = (preset: NotificationPreset) => {
    const previous = uiPreset(getPreset(kind, id));
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
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={t('notif_presets.title')} tabIndex={-1}
         className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center">
      <div aria-hidden="true" className="absolute inset-0 bg-black/40 animate-[fadeIn_.15s_ease-out]" onClick={onClose} />

      <div className="relative w-full sm:max-w-md bg-white dark:bg-slate-900 shadow-2xl
                      rounded-t-3xl sm:rounded-3xl p-5
                      pb-[calc(1.75rem+env(safe-area-inset-bottom))] sm:pb-5
                      animate-[fadeIn_.18s_ease-out] max-h-[85vh] overflow-y-auto">
        {/* Asa de bottom sheet (solo móvil) */}
        <div className="sm:hidden mx-auto mb-4 h-1.5 w-10 rounded-full bg-slate-200 dark:bg-slate-700" />

        <button
          type="button"
          onClick={onClose}
          aria-label={t('notif_presets.close')}
          className="absolute right-2 top-2 inline-flex items-center justify-center w-11 h-11 rounded-full
                     text-slate-500 hover:text-slate-700 hover:bg-slate-100
                     dark:text-slate-400 dark:hover:text-slate-200 dark:hover:bg-slate-800
                     transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-rink-passion dark:focus-visible:ring-rink-accent"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
               className="w-5 h-5" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
          </svg>
        </button>

        <h2 className="text-base font-bold text-slate-900 dark:text-slate-50 pr-10">
          {t('notif_presets.title')}
        </h2>
        {name && (
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 mb-3 pr-10 truncate">{name}</p>
        )}

        {/* Seguir no basta: sin permiso del navegador no llega ningún aviso. */}
        <div className="mt-3"><PushOfferCard source="preset_sheet" /></div>

        <div className="space-y-2 mt-3">
          {options.map((p) => {
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
                <span className={`mt-0.5 ${active ? 'text-rink-passion' : 'text-slate-500 dark:text-slate-400'}`}>
                  <PresetIcon preset={p} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">{t(`notif_presets.${p}.label`)}</span>
                  <span className={`block text-xs mt-0.5 ${active ? 'text-rink-passion/80' : 'text-slate-500 dark:text-slate-400'}`}>
                    {t(descKey(kind, p))}
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
