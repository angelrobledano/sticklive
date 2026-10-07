import { useCallback, useEffect, useState } from 'react';
import { Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSession } from '@/src/context/AuthContext';
import { useLocale } from '@/src/i18n/LocaleContext';
import { usePremiumStatus } from '@/src/hooks/usePremiumStatus';
import { capture } from '@/src/lib/analytics';
import { WEB_URL, buildWebPremiumUrl } from '@/src/lib/api/client';

/**
 * Pantalla Premium (monetización, spec §7): lee el entitlement de la SESIÓN
 * (GET /payments/status vía usePremiumStatus) y la compra NUNCA ocurre en la
 * app — el botón principal abre sticklive.eu/{locale}/settings en el NAVEGADOR
 * DEL SISTEMA (la compra vive en Ajustes de la web, PremiumBanner con Stripe;
 * la landing /premium dedicada es mejora futura) y, al volver, el refresco
 * on-focus del hook recoge el estado nuevo. Cero SDK de pagos.
 *
 * Contrato del hook: `premium === undefined` con sesión = estado desconocido
 * (cargando o error) → aquí se muestra "Comprobando tu estado…" y NUNCA la
 * oferta de compra ni un flash del estado activo. Sin sesión no hay entitlement
 * que consultar: la compra exige cuenta (queda ligada a la misma fila de
 * usuario), así que se ofrece iniciar sesión en la pestaña de Ajustes.
 */
export default function PremiumScreen() {
  const { t, locale } = useLocale();
  const { session, ready } = useSession();
  const { premium, premiumLifetime, refresh } = usePremiumStatus();
  const router = useRouter();
  const [openError, setOpenError] = useState(false);

  // Funnel premium (Task 5.1): la cima del funnel solo la cuentan PROSPECTOS —
  // paridad con la web, donde el banner solo se renderiza (y solo emite) siendo
  // no premium. Un premium que reabra la pantalla no infla `premium_viewed`.
  // Se emite al resolver el estado (premium === false), no al montar en ciego.
  useEffect(() => {
    if (premium === false) capture('premium_viewed', { from_screen: 'settings' });
  }, [premium]);

  /** Única vía de compra: navegador del sistema, web, cuenta del usuario. */
  const handleBuyOnWeb = useCallback(() => {
    capture('premium_web_checkout_started', {});
    setOpenError(false);
    void Linking.openURL(buildWebPremiumUrl(WEB_URL, locale)).catch((err: unknown) => {
      // Nunca silencioso (regla del repo): visible en pantalla + consola.
      console.error('[premium] no se pudo abrir la web de compra', err);
      setOpenError(true);
    });
  }, [locale]);

  // Sesión persistida aún cargando (SecureStore): sin rama decidida no hay
  // flash de "inicia sesión" para quien sí tiene cuenta (patrón settings.tsx).
  const sessionUnknown = !ready;

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 24 }} className="flex-1 bg-rink-floor dark:bg-rink-floor-dark">
      <Text className="px-4 pt-4 text-2xl font-bold text-slate-900 dark:text-slate-100">
        {t('premium.title')}
      </Text>

      {sessionUnknown ? null : session ? (
        <>
          {premium === undefined ? (
            // Desconocido (cargando o error de /payments/status): fail-closed —
            // ni productos ni estado activo hasta tener un dato real.
            <View className="mx-4 mt-3 rounded-xl bg-white p-4 dark:bg-slate-900">
              <Text className="text-sm text-slate-500">{t('premium.loading')}</Text>
            </View>
          ) : premium ? (
            // Premium (anual o para siempre): cero oferta de compra.
            <View className="mx-4 mt-3 rounded-xl bg-white p-4 dark:bg-slate-900">
              <View className="self-start rounded-full bg-amber-400 px-3 py-1">
                <Text className="text-xs font-bold text-amber-950">
                  {premiumLifetime ? t('premium.status_lifetime') : t('premium.status_active')}
                </Text>
              </View>
              <Text className="mt-3 text-sm text-slate-500">{t('premium.status_active_desc')}</Text>
            </View>
          ) : (
            // No premium: productos informativos (precio real solo en la web) y
            // UNA vía de compra: el navegador del sistema.
            <View className="mx-4 mt-3 rounded-xl bg-white p-4 dark:bg-slate-900">
              <Text className="text-base font-semibold text-slate-900 dark:text-slate-100">
                {t('premium.upgrade_title')}
              </Text>
              <Text className="mt-0.5 text-sm text-slate-500">{t('premium.upgrade_desc')}</Text>

              <View className="mt-4 border-t border-slate-100 pt-3 dark:border-slate-800">
                <Text className="text-sm font-medium text-slate-800 dark:text-slate-200">
                  {t('premium.product_annual')}
                </Text>
                <Text className="mt-0.5 text-xs text-slate-500">{t('premium.product_annual_desc')}</Text>
              </View>
              <View className="mt-3 border-t border-slate-100 pt-3 dark:border-slate-800">
                <Text className="text-sm font-medium text-slate-800 dark:text-slate-200">
                  {t('premium.product_lifetime')}
                </Text>
                <Text className="mt-0.5 text-xs text-slate-500">{t('premium.product_lifetime_desc')}</Text>
              </View>

              <Pressable
                onPress={handleBuyOnWeb}
                accessibilityRole="button"
                className="mt-4 min-h-[44px] justify-center rounded-lg bg-rink-passion px-4 active:opacity-80"
              >
                <Text className="text-center font-semibold text-white">{t('premium.buy_on_web')}</Text>
              </Pressable>
              <Text className="mt-2 text-xs text-slate-500">{t('premium.buy_on_web_desc')}</Text>
              {openError ? (
                <Text
                  className="mt-2 text-sm text-red-600 dark:text-red-400"
                  accessibilityLiveRegion="polite"
                >
                  {t('premium.open_failed')}
                </Text>
              ) : null}
            </View>
          )}

          {/* Secundario: revalida el estado (post-compra o tras un error). */}
          <Pressable
            onPress={refresh}
            accessibilityRole="button"
            className="mx-4 mt-3 min-h-[44px] justify-center rounded-lg border border-slate-300 px-4 active:opacity-70 dark:border-slate-600"
          >
            <Text className="text-center font-semibold text-slate-700 dark:text-slate-300">
              {t('premium.refresh')}
            </Text>
          </Pressable>
        </>
      ) : (
        // Sin sesión no hay entitlement: la compra exige cuenta (el pago en web
        // queda ligado a la misma fila de usuario).
        <View className="mx-4 mt-3 rounded-xl bg-white p-4 dark:bg-slate-900">
          <Text className="text-sm text-slate-500">{t('premium.login_required')}</Text>
          <Pressable
            onPress={() => router.push('/settings')}
            accessibilityRole="button"
            className="mt-3 min-h-[44px] justify-center self-start rounded-lg bg-rink-passion px-4 active:opacity-80"
          >
            <Text className="font-semibold text-white">{t('premium.login_cta')}</Text>
          </Pressable>
        </View>
      )}
    </ScrollView>
  );
}
