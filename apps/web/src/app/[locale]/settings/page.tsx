'use client';

import { useEffect, useMemo, useState } from 'react';
import { LocaleLink as Link } from '@/components/shared/LocaleLink';
import { useFavorites } from '@/hooks/useFavorites';
import { useT } from '@/lib/i18n';
import { usePremium } from '@/context/PremiumContext';
import { InstallApp } from '@/components/shared/InstallApp';
import {
  notificationPermission, isIOS, isStandalone, vapidMissing,
} from '@/lib/push';
import { PREMIUM_ENABLED } from './config';
import {
  SettingRow, SettingsBlock, SettingsNav, SegmentedControl, PremiumActiveBadge,
} from './ui';
import { useDeviceId, useNotifConfig, useTheme } from './hooks';
import { settingsSections } from './sections';
import { PremiumBanner } from './PremiumBanner';
import { AccountCard, FavoritesSummary, LanguageRow, SubHeader } from './cards';
import { NotificationStatus } from './NotificationStatus';
import { openConsentManager } from '@/lib/consent-tcf';

// ─── Fila de navegación (título + chevron) ────────────────────────────────────

function NavRow({ label, href, count, disabled = false }: {
  label: string;
  href: string;
  count?: number;
  /** Cuando el push está apagado o bloqueado, la fila deja de ser un enlace. */
  disabled?: boolean;
}) {
  const content = (
    <>
      <span className={`flex-1 text-sm font-medium ${
        disabled
          ? 'text-slate-400 dark:text-slate-500'
          : 'text-slate-800 dark:text-slate-200'
      }`}>
        {label}
      </span>
      {typeof count === 'number' && count > 0 && (
        <span className={`text-xs tabular-nums ${
          disabled ? 'text-slate-400 dark:text-slate-500' : 'text-slate-500 dark:text-slate-400'
        }`}>
          {count}
        </span>
      )}
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
           className={`w-4 h-4 shrink-0 ${
             disabled
               ? 'text-slate-200 dark:text-slate-700'
               : 'text-slate-300 dark:text-slate-600 group-hover:text-rink-passion dark:group-hover:text-rink-accent'
           } transition-colors`}>
        <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </>
  );

  if (disabled) {
    return (
      <div aria-disabled="true" className="flex items-center gap-3 py-3.5">
        {content}
      </div>
    );
  }

  return (
    <Link href={href} className="flex items-center gap-3 py-3.5 group">
      {content}
    </Link>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

export default function SettingsPage() {
  const { t } = useT();
  const theme = useTheme();
  const { config, set: setNotif, update: updateNotif, mounted: notifMounted } = useNotifConfig();
  const { favorites, leagues, players } = useFavorites();
  const { isPremium, mounted: premiumMounted } = usePremium();
  const deviceId = useDeviceId();
  const [consentError, setConsentError] = useState(false);
  // La sección "La app" solo tiene sentido mientras la PWA no está instalada.
  // `null` = aún sin comprobar (SSR/primer render): no se pinta para no mostrar
  // el bloque a quien ya la tiene instalada.
  const [installed, setInstalled] = useState<boolean | null>(null);
  useEffect(() => {
    setInstalled(isStandalone());
    const onInstalled = () => setInstalled(true);
    window.addEventListener('pwa-installed', onInstalled);
    return () => window.removeEventListener('pwa-installed', onInstalled);
  }, []);

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

  const sections = useMemo(() => settingsSections(t, installed), [t, installed]);

  const allMounted = theme.mounted && notifMounted && premiumMounted;

  if (!allMounted) {
    return (
      <div className="px-4 py-8 max-w-2xl mx-auto space-y-6 animate-pulse">
        <div className="space-y-2">
          <div className="h-6 w-32 bg-slate-200 dark:bg-slate-800 rounded" />
          <div className="h-3 w-56 bg-slate-200 dark:bg-slate-800 rounded" />
        </div>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="space-y-2">
            <div className="h-3 w-32 bg-slate-200 dark:bg-slate-800 rounded" />
            <div className="card h-24" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="px-4 pb-8 max-w-2xl mx-auto">
      {/* Cabecera */}
      <div className="space-y-1 pt-2 pb-3">
        <h1 className="text-2xl font-extrabold text-slate-900 dark:text-slate-50">{t('settings.title')}</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">{t('settings.subtitle')}</p>
      </div>

      <SettingsNav items={sections} />

      <div className="space-y-6 pt-5">
        {/* ── Banner Premium (oculto mientras la app sea gratis) ───────────── */}
        {PREMIUM_ENABLED && (
          isPremium ? <PremiumActiveBadge /> : <PremiumBanner deviceId={deviceId} />
        )}

        {/* ── Cuenta ───────────────────────────────────────────────────────── */}
        <SettingsBlock
          id="cuenta"
          title={t('settings.section_account')}
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
              <circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
            </svg>
          }
        >
          <AccountCard />
        </SettingsBlock>

        {/* ── La app (solo mientras la PWA no esté instalada) ──────────────── */}
        {installed === false && (
          <SettingsBlock
            id="app"
            title={t('settings.section_app')}
            icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                <rect x="7" y="2" width="10" height="20" rx="2" />
                <path d="M11 18h2" strokeLinecap="round" />
              </svg>
            }
          >
            <InstallApp />
            <div className="py-3.5">
              <p className="text-xs text-slate-500 dark:text-slate-400">{t('settings.footer')}</p>
            </div>
          </SettingsBlock>
        )}

        {/* ── Notificaciones ───────────────────────────────────────────────── */}
        <SettingsBlock
          id="notificaciones"
          title={t('settings.notif_title')}
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
          }
        >
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
        </SettingsBlock>

        {/* ── Favoritos (resumen; la gestión vive en /favorites) ───────────── */}
        <SettingsBlock
          id="favoritos"
          title={t('navigation.favorites')}
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" strokeLinejoin="round" />
            </svg>
          }
        >
          <FavoritesSummary />
        </SettingsBlock>

        {/* ── Apariencia e idioma ──────────────────────────────────────────── */}
        <SettingsBlock
          id="preferencias"
          title={t('settings.section_preferences')}
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" strokeLinecap="round" />
            </svg>
          }
        >
          <div className="flex flex-col gap-3 py-3.5 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-800 dark:text-slate-200">{t('settings.theme')}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-snug">
                {t('settings.theme_desc')}
              </p>
            </div>
            <SegmentedControl
              label={t('settings.theme')}
              // Sin opción "Sistema": si no hay elección explícita, se muestra
              // la que resuelve el SO. Elegir claro/oscuro fija la preferencia.
              value={theme.resolved}
              onChange={theme.set}
              options={[
                { value: 'light', label: t('settings.theme_light') },
                { value: 'dark',  label: t('settings.theme_dark') },
              ]}
            />
          </div>

          <LanguageRow />

          <p className="py-2.5 text-[11px] text-slate-500 dark:text-slate-400">
            {t('settings.choice_saved')}
          </p>
        </SettingsBlock>

        {/* ── Privacidad ──────────────────────────────────────────────────── */}
        <SettingsBlock
          id="privacidad"
          title={t('settings.section_privacy')}
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
              <rect x="4" y="10" width="16" height="11" rx="2" />
              <path d="M8 10V7a4 4 0 0 1 8 0v3" strokeLinecap="round" />
            </svg>
          }
        >
          <div className="py-3.5 space-y-1.5">
            <button
              type="button"
              onClick={async () => {
                const opened = await openConsentManager();
                setConsentError(!opened);
              }}
              className="text-sm font-medium text-slate-800 dark:text-slate-200 underline underline-offset-2 hover:text-rink-passion dark:hover:text-rink-accent"
            >
              {t('ads.privacy_entry_title')}
            </button>
            <p className="text-xs text-slate-500 dark:text-slate-400">{t('ads.privacy_entry_desc')}</p>
            {consentError && (
              <p role="alert" className="text-xs text-red-600 dark:text-red-400">{t('ads.privacy_error')}</p>
            )}
          </div>

          <div className="py-3.5">
            <Link
              href="/privacy"
              className="text-sm font-medium text-slate-800 dark:text-slate-200 underline underline-offset-2 hover:text-rink-passion dark:hover:text-rink-accent"
            >
              {t('settings.privacy_link')}
            </Link>
          </div>
        </SettingsBlock>
      </div>
    </div>
  );
}
