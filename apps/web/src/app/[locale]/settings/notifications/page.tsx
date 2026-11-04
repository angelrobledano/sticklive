'use client';

import { useEffect, useState } from 'react';
import { useFavorites } from '@/hooks/useFavorites';
import { useT } from '@/lib/i18n';
import { BackLink } from '@/components/shared/BackLink';
import { notificationPermission, isIOS, isStandalone, vapidMissing } from '@/lib/push';
import { SettingRow, NavRow } from '../ui';
import { useDeviceId, useNotifConfig } from '../hooks';
import { SubHeader } from '../cards';
import { NotificationStatus } from '../NotificationStatus';

/**
 * Notificaciones en su propia pantalla (rediseño de Ajustes, 04/11/2026): en
 * el índice ocupaban unas 10 filas y enterraban el resto. Mismo bloque que
 * antes, sin cambios de comportamiento.
 */
export default function NotificationSettingsPage() {
  const { t } = useT();
  const { config, set: setNotif, update: updateNotif, mounted } = useNotifConfig();
  const { favorites, leagues, players } = useFavorites();
  const deviceId = useDeviceId();

  // ¿Está el push bloqueado en este dispositivo? (permiso denegado, sin soporte,
  // iPhone sin instalar o sin clave VAPID) → los controles que dependen del
  // permiso se desactivan de verdad, no solo visualmente.
  const [notifBlocked, setNotifBlocked] = useState(false);
  useEffect(() => {
    const check = () => {
      const perm = notificationPermission();
      setNotifBlocked(vapidMissing() || perm === 'unsupported' || perm === 'denied' || (isIOS() && !isStandalone()));
    };
    check();
    window.addEventListener('focus', check);
    return () => window.removeEventListener('focus', check);
  }, []);

  const notifDisabled = !config.master || notifBlocked;
  const showEnableHint = !config.master && !notifBlocked;

  return (
    <div className="px-4 pb-8 max-w-2xl mx-auto">
      <BackLink href="/settings" />
      <h1 className="pt-1 pb-4 text-2xl font-extrabold text-slate-900 dark:text-slate-50">{t('settings.notif_title')}</h1>
      {mounted && (
        <div className="card px-4 divide-y divide-slate-100 dark:divide-slate-800/60">
          {/* Estado del dispositivo + Activar/Probar */}
          <NotificationStatus deviceId={deviceId} />

          {/* Si el push no está disponible en este dispositivo, no pintamos
              controles muertos: solo el estado y cómo resolverlo. */}
          {!notifBlocked && (
            <>
              {/* Switch maestro — control absoluto del sistema */}
              <SettingRow
                label={t('settings.master')}
                description={t('settings.master_desc')}
                checked={config.master}
                onChange={() => setNotif('master')}
              />

              {showEnableHint && (
                <p className="py-2.5 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                  {t('settings.notif_enable_hint')}
                </p>
              )}

              {/* Alertas de la jornada (inicio + resumen, toggle único) */}
              <SubHeader label={t('settings.sec_jornada')} />
              <SettingRow
                label={t('settings.jornada_alerts')}
                description={t('settings.jornada_alerts_desc')}
                checked={config.globalJornadaStart || config.globalJornadaEnd}
                onChange={() => {
                  const on = !(config.globalJornadaStart || config.globalJornadaEnd);
                  updateNotif({ globalJornadaStart: on, globalJornadaEnd: on });
                }}
                disabled={notifDisabled}
              />

              {/* Notificaciones de mis favoritos (navegación por entidad) */}
              <SubHeader label={t('settings.sec_favs')} />
              <NavRow
                label={t('settings.notif_nav_competitions')}
                href="/settings/notifications/competitions"
                count={leagues.length}
                disabled={notifDisabled}
              />
              <NavRow
                label={t('settings.notif_nav_teams')}
                href="/settings/notifications/teams"
                count={favorites.length}
                disabled={notifDisabled}
              />
              <NavRow
                label={t('settings.notif_nav_players')}
                href="/settings/notifications/players"
                count={players.length}
                disabled={notifDisabled}
              />

              {/* Descanso */}
              <SubHeader label={t('settings.sec_rest')} />
              <SettingRow
                label={t('settings.quiet')}
                description={t('settings.quiet_desc')}
                checked={config.quietNight}
                onChange={() => setNotif('quietNight')}
                disabled={notifDisabled}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}
