'use client';

import { useState, useEffect } from 'react';
import { useT } from '@/lib/i18n';
import {
  enablePush, notificationPermission, isIOS, isStandalone, vapidMissing, sendTestPush,
} from '@/lib/push';

// ─── Estado de notificaciones (soporte, permiso, iOS) + prueba ───

export function NotificationStatus({ deviceId }: { deviceId: string }) {
  const { t } = useT();
  const [perm, setPerm] = useState<NotificationPermission | 'unsupported'>('default');
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

  // Mensaje de contexto
  let note: string | null = null;
  if (noVapid || perm === 'unsupported') note = t('settings.notif_unavailable');
  else if (ios && !standalone)           note = t('settings.notif_ios_install');
  else if (perm === 'denied')            note = t('settings.notif_denied');

  const btn =
    'inline-flex items-center gap-2 min-h-[40px] px-3.5 rounded-xl text-xs font-semibold ' +
    'disabled:opacity-50 transition-colors';

  return (
    <div className="py-3 space-y-2">
      {note && (
        <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">{note}</p>
      )}

      {/* Sin permiso aún → botón para activarlo aquí mismo */}
      {!blocked && perm !== 'granted' && perm !== 'denied' && (
        <button
          onClick={activate}
          disabled={busy}
          className={`${btn} bg-rink-passion text-white hover:opacity-90`}
        >
          {busy && <span className="w-3.5 h-3.5 rounded-full border-2 border-white/40 border-t-white animate-spin" />}
          {t('settings.notif_activate_btn')}
        </button>
      )}

      {/* Permiso concedido → botón de prueba */}
      {!blocked && perm === 'granted' && (
        <button
          onClick={test}
          disabled={busy}
          className={`${btn} border border-rink-passion/30 text-rink-passion hover:bg-rink-passion/5`}
        >
          {busy && <span className="w-3.5 h-3.5 rounded-full border-2 border-rink-passion/30 border-t-rink-passion animate-spin" />}
          {busy ? t('settings.notif_test_sending') : t('settings.notif_test_btn')}
        </button>
      )}

      {result && <p className="text-xs text-slate-500 dark:text-slate-400">{result}</p>}
    </div>
  );
}
