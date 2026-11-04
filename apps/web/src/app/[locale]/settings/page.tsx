'use client';

import { tt } from '@/components/search/translate';
import { CountryPicker } from '@/components/shared/CountryPicker';
import { useEffect, useState } from 'react';
import { LocaleLink as Link } from '@/components/shared/LocaleLink';
import { useFavorites } from '@/hooks/useFavorites';
import { useT } from '@/lib/i18n';
import { usePremium } from '@/context/PremiumContext';
import { InstallApp } from '@/components/shared/InstallApp';
import {
  notificationPermission, isIOS, isStandalone, vapidMissing,
} from '@/lib/push';
import { PREMIUM_ENABLED } from './config';
import { SettingsBlock, SegmentedControl, PremiumActiveBadge, FieldRow, ActionRow, NavRow } from './ui';
import { useDeviceId, useNotifConfig, useTheme } from './hooks';
import { PremiumBanner } from './PremiumBanner';
import { AccountCard, LanguageRow } from './cards';
import { openConsentManager } from '@/lib/consent-tcf';
import { resetFallbackConsent, requestFallbackConsent } from '@/lib/consent-fallback';

// ─── Componente principal ─────────────────────────────────────────────────────

export default function SettingsPage() {
  const { t } = useT();
  const theme = useTheme();
  const { config, mounted: notifMounted } = useNotifConfig();
  const { favorites, leagues, players } = useFavorites();
  const { isPremium, mounted: premiumMounted } = usePremium();
  const deviceId = useDeviceId();
  const [privacyBusy, setPrivacyBusy] = useState(false);
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

  const totalFavs = favorites.length + leagues.length + players.length;
  // Privacidad (04/11/2026): el gestor de Google solo cuenta si se ve. Si no
  // (sin mensaje publicado, bloqueador), se abre el aviso propio. Siempre pasa algo.
  const openPrivacy = async () => {
    setPrivacyBusy(true);
    const opened = await openConsentManager();
    setPrivacyBusy(false);
    if (!opened) {
      resetFallbackConsent();
      requestFallbackConsent();
    }
  };
  const notifValue = notifBlocked
    ? tt(t, 'settings.notif_unavailable', 'No disponibles')
    : config.master && notificationPermission() === 'granted'
      ? tt(t, 'settings.notif_on', 'Activadas')
      : tt(t, 'settings.notif_off', 'Desactivadas');
  const legal = (label: string, href: string) => (
    <ActionRow label={label}>
      {(content) => <Link href={href} className="group flex items-center gap-3 py-3.5">{content}</Link>}
    </ActionRow>
  );

  // Rediseño (04/11/2026), patrón de FotMob, Flashscore y SofaScore: índice
  // corto y agrupado, la cuenta arriba, las notificaciones en su pantalla y
  // la privacidad y lo legal al final.
  return (
    <div className="px-4 pb-8 max-w-2xl mx-auto">
      <h1 className="pt-2 pb-4 text-2xl font-extrabold text-slate-900 dark:text-slate-50">{t('settings.title')}</h1>

      <div className="space-y-6">
        {PREMIUM_ENABLED && (
          isPremium ? <PremiumActiveBadge /> : <PremiumBanner deviceId={deviceId} />
        )}

        <div className="card px-4"><AccountCard /></div>

        <SettingsBlock title={tt(t, 'settings.section_alerts', 'Avisos y favoritos')} icon={ICON_BELL}>
          <NavRow label={t('settings.notif_title')} href="/settings/notifications" value={notifValue} />
          <NavRow label={t('navigation.favorites')} href="/favorites" count={totalFavs} />
          {installed === false && (
            <div className="py-1"><InstallApp /></div>
          )}
        </SettingsBlock>

        <SettingsBlock title={tt(t, 'settings.section_personal', 'Personalización')} icon={ICON_SUN}>
          <FieldRow label={t('settings.theme')}>
            <SegmentedControl
              label={t('settings.theme')}
              value={theme.resolved}
              onChange={theme.set}
              options={[
                { value: 'light', label: t('settings.theme_light') },
                { value: 'dark',  label: t('settings.theme_dark') },
              ]}
            />
          </FieldRow>
          <LanguageRow />
          <FieldRow
            label={tt(t, 'home.country_label', 'País preferido')}
            description={tt(t, 'settings.country_desc', 'Sus competiciones salen primero en la portada. Las demás siguen ahí.')}
          >
            <CountryPicker variant="field" />
          </FieldRow>
        </SettingsBlock>

        <SettingsBlock title={tt(t, 'settings.section_legal', 'Privacidad y legal')} icon={ICON_LOCK}>
          <ActionRow
            label={tt(t, 'settings.privacy_cookies', 'Privacidad y cookies')}
            description={privacyBusy
              ? tt(t, 'common.loading', 'Cargando…')
              : tt(t, 'settings.privacy_cookies_desc', 'Elige qué analítica y publicidad aceptas')}
            onClick={openPrivacy}
          />
          {legal(t('settings.privacy_link'), '/privacy')}
          {legal(tt(t, 'settings.legal_notice', 'Aviso legal'), '/legal')}
          {legal(tt(t, 'settings.contact', 'Contacto'), '/contact')}
        </SettingsBlock>

        <p className="pt-2 text-center text-xs text-slate-400 dark:text-slate-500">{t('settings.footer')}</p>
      </div>
    </div>
  );
}

const ICON_BELL = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
  </svg>
);
const ICON_SUN = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" strokeLinecap="round" />
  </svg>
);
const ICON_LOCK = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
    <rect x="4" y="10" width="16" height="11" rx="2" />
    <path d="M8 10V7a4 4 0 0 1 8 0v3" strokeLinecap="round" />
  </svg>
);
