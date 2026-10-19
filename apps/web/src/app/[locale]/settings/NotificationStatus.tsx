'use client';

import { useState, useEffect } from 'react';
import { useT } from '@/lib/i18n';
import {
  enablePush, notificationPermission, isIOS, isStandalone, vapidMissing, sendTestPush,
} from '@/lib/push';

// ─── Estado de notificaciones (soporte, permiso, iOS) + prueba ───

export function NotificationStatus({ deviceId }: { deviceId: string }) {
  const { t } = useT();
  // `null` = aún no se ha leído el permiso en cliente. Evita enseñar un CTA
  // equivocado durante el primer render.
  const [perm, setPerm] = useState<NotificationPermission | 'unsupported' | null>(null);
  const [ios, setIos]   = useState(false);
  const [standalone, setStandalone] = useState(true);
  const [noVapid, setNoVapid] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    setPerm(notificationPermission());
    setIos(isIOS());
    setStandalone(isStandalone());
    setNoVapid(vapidMissing());

    // Refrescar el permiso cuando cambie (lo concede el navegador, p. ej. al
    // pulsar Activar o el interruptor maestro) o al volver a la pestaña.
    const refresh = () => setPerm(notificationPermission());
    window.addEventListener('focus', refresh);
    let permStatus: PermissionStatus | null = null;
    if (typeof navigator !== 'undefined' && 'permissions' in navigator) {
      navigator.permissions.query({ name: 'notifications' as PermissionName })
        .then((s) => { permStatus = s; s.onchange = refresh; })
        .catch(() => { /* Safari iOS puede no soportar permissions.query */ });
    }
    return () => {
      window.removeEventListener('focus', refresh);
      if (permStatus) permStatus.onchange = null;
    };
  }, []);

  // Pide permiso y suscribe (no depende del interruptor maestro).
  const activate = async () => {
    setBusy(true);
    setResult(null);
    await enablePush();
    setPerm(notificationPermission());
    setBusy(false);
  };

  const test = async () => {
    if (!deviceId) return;
    setBusy(true);
    setResult(null);
    const r = await sendTestPush(deviceId);
    setBusy(false);
    setResult(
      r.ok
        ? (r.sent && r.sent > 0 ? t('settings.notif_test_ok') : t('settings.notif_test_nosub'))
        : t('settings.notif_test_fail')
    );
  };

  // ¿Es posible push en este dispositivo/navegador?
  const blocked = noVapid || perm === 'unsupported' || (ios && !standalone);
  const denied  = perm === 'denied';
  const active  = perm === 'granted' && !blocked;

  // Mensaje de contexto
  let note: string | null = null;
  if (noVapid || perm === 'unsupported') note = t('settings.notif_unavailable');
  else if (ios && !standalone)           note = t('settings.notif_ios_install');
  else if (denied)                       note = t('settings.notif_denied');

  const status = active
    ? t('settings.notif_status_active')
    : (blocked || denied)
      ? t('settings.notif_status_blocked')
      : t('settings.notif_status_inactive');

  const btn =
    'inline-flex items-center gap-1.5 justify-center min-h-[44px] px-3 rounded-lg ' +
    'text-xs font-semibold disabled:opacity-50 transition-colors ' +
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-rink-passion/60 ' +
    'dark:focus-visible:ring-rink-accent/60';

  return (
    <>
      <div className="flex items-center gap-3 py-3.5">
        <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${
          active
            ? 'bg-rink-passion/10 text-rink-passion dark:bg-rink-accent/15 dark:text-rink-accent'
            : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
        }`}>
          {active ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} className="w-[18px] h-[18px]">
              <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-[18px] h-[18px]">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-slate-800 dark:text-slate-200 leading-snug">
            {status}
          </p>
          {note && (
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">{note}</p>
          )}
        </div>

        {/* Permiso concedido → probar en este dispositivo */}
        {active && (
          <button
            type="button"
            onClick={test}
            disabled={busy || !deviceId}
            className={`${btn} border border-rink-passion/30 text-rink-passion hover:bg-rink-passion/5`}
          >
            {busy && <span className="w-3.5 h-3.5 rounded-full border-2 border-rink-passion/30 border-t-rink-passion animate-spin" aria-hidden="true" />}
            {busy ? t('settings.notif_test_sending') : t('settings.notif_test_short')}
          </button>
        )}

        {/* Aún sin permiso → activarlo aquí mismo */}
        {!blocked && !denied && perm === 'default' && (
          <button
            type="button"
            onClick={activate}
            disabled={busy}
            className={`${btn} bg-rink-passion text-white hover:bg-rink-passion-light`}
          >
            {busy && <span className="w-3.5 h-3.5 rounded-full border-2 border-white/40 border-t-white animate-spin" aria-hidden="true" />}
            {t('settings.notif_activate_short')}
          </button>
        )}
      </div>

      {result && (
        <p role="status" className="pb-3 text-xs text-slate-500 dark:text-slate-400">{result}</p>
      )}
    </>
  );
}
