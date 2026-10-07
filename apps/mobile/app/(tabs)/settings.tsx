import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSession } from '@/src/context/AuthContext';
import { useLocale } from '@/src/i18n/LocaleContext';
import { LOCALES, type Locale } from '@/src/i18n/locales';
import { useThemePref, type ThemePref } from '@/src/theme/ThemeContext';
import { authErrorKey } from '@/src/lib/auth-errors';

/**
 * Ajustes (Task 3.4). Orden coherente con la página de settings de la web
 * (apps/web/src/app/[locale]/settings/page.tsx): tema antes de idioma y
 * notificaciones al final; la cuenta queda arriba como en Task 3.2.
 * Notificaciones enlaza a settings/notifications (Task 4.2, push nativo).
 */

/** Endónimos: el nombre del idioma en sí mismo no se traduce (paridad con
 * LOCALE_NAMES de la web, src/lib/locales.ts). */
const LOCALE_NAMES: Record<Locale, string> = {
  en: 'English', es: 'Español', fr: 'Français', it: 'Italiano', pt: 'Português',
};

/** Opciones de apariencia: valor del ThemePref + clave i18n de la etiqueta. */
const THEME_OPTIONS: { value: ThemePref; labelKey: string }[] = [
  { value: 'system', labelKey: 'settings.theme_system' },
  { value: 'light', labelKey: 'settings.theme_light' },
  { value: 'dark', labelKey: 'settings.theme_dark' },
];

/** Chip de opción (mismo patrón que la barra de competiciones de standings). */
function OptionChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      className={`min-h-[44px] justify-center rounded-full px-3 active:opacity-70 ${
        active ? 'bg-rink-passion' : 'bg-slate-100 dark:bg-slate-800'
      }`}
    >
      <Text
        className={`text-sm font-semibold ${active ? 'text-white' : 'text-slate-700 dark:text-slate-200'}`}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export default function SettingsScreen() {
  const { t, locale, setLocale } = useLocale();
  const { pref, setPref } = useThemePref();
  const { session, ready, lastAuthError, signInWithGoogle, signOut } = useSession();
  const [signingIn, setSigningIn] = useState(false);
  const router = useRouter();

  const handleSignIn = () => {
    setSigningIn(true);
    // signInWithGoogle captura sus fallos en lastAuthError (no lanza), pero el
    // finally garantiza reactivar el botón pase lo que pase.
    void signInWithGoogle().finally(() => setSigningIn(false));
  };

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 24 }} className="flex-1 bg-rink-floor dark:bg-rink-floor-dark">
      <Text className="px-4 pt-4 text-2xl font-bold text-slate-900 dark:text-slate-100">
        {t('settings.title')}
      </Text>

      {/* Cuenta (Task 3.2) */}
      <View className="mx-4 mt-4 rounded-xl bg-white p-4 dark:bg-slate-900">
        <Text className="text-base font-semibold text-slate-900 dark:text-slate-100">
          {t('settings.account_login')}
        </Text>
        <Text className="mt-0.5 text-sm text-slate-500">{t('settings.account_login_desc')}</Text>

        {!ready ? null : session ? (
          <>
            <Text
              className="mt-3 text-sm font-medium text-slate-700 dark:text-slate-300"
              accessibilityLabel={session.email ?? undefined}
            >
              {session.email}
            </Text>
            <Text className="mt-0.5 text-xs text-emerald-600">{t('settings.account_synced')}</Text>
            <Pressable
              onPress={() => void signOut()}
              className="mt-3 self-start rounded-lg border border-slate-300 px-4 py-2 active:opacity-70 dark:border-slate-600"
            >
              <Text className="font-semibold text-slate-700 dark:text-slate-300">
                {t('settings.logout')}
              </Text>
            </Pressable>
          </>
        ) : (
          <>
            <Pressable
              onPress={handleSignIn}
              disabled={signingIn}
              className="mt-3 self-start rounded-lg bg-rink-passion px-4 py-2 active:opacity-80 disabled:opacity-50"
            >
              <Text className="font-semibold text-white">
                {signingIn ? t('auth.opening_account') : t('auth.google')}
              </Text>
            </Pressable>
            {lastAuthError ? (
              <Text
                className="mt-2 text-sm text-red-600 dark:text-red-400"
                accessibilityLiveRegion="polite"
              >
                {t(authErrorKey(lastAuthError))}
              </Text>
            ) : null}
          </>
        )}
      </View>

      {/* Premium (monetización): estado de la cuenta y compra SOLO en la web */}
      <Pressable
        onPress={() => router.push('/settings/premium')}
        accessibilityRole="button"
        className="mx-4 mt-3 flex-row items-center justify-between rounded-xl bg-white p-4 active:opacity-70 dark:bg-slate-900"
      >
        <View className="flex-1 pr-2">
          <Text className="text-base font-semibold text-slate-900 dark:text-slate-100">
            {t('premium.title')}
          </Text>
          <Text className="mt-0.5 text-sm text-slate-500">{t('premium.upgrade_desc')}</Text>
        </View>
        <Ionicons name="star-outline" size={20} color="#64748b" />
      </Pressable>

      {/* Apariencia: sistema/claro/oscuro (persistencia en ThemeContext) */}
      <View className="mx-4 mt-3 rounded-xl bg-white p-4 dark:bg-slate-900">
        <Text className="text-base font-semibold text-slate-900 dark:text-slate-100">
          {t('settings.appearance')}
        </Text>
        <View className="mt-3 flex-row flex-wrap gap-2">
          {THEME_OPTIONS.map((o) => (
            <OptionChip
              key={o.value}
              label={t(o.labelKey)}
              active={pref === o.value}
              onPress={() => setPref(o.value)}
            />
          ))}
        </View>
      </View>

      {/* Idioma: los 5 locales de la web (persistencia en LocaleContext) */}
      <View className="mx-4 mt-3 rounded-xl bg-white p-4 dark:bg-slate-900">
        <Text className="text-base font-semibold text-slate-900 dark:text-slate-100">
          {t('common.language')}
        </Text>
        <View className="mt-3 flex-row flex-wrap gap-2">
          {LOCALES.map((l) => (
            <OptionChip
              key={l}
              label={LOCALE_NAMES[l]}
              active={locale === l}
              onPress={() => setLocale(l)}
            />
          ))}
        </View>
      </View>

      {/* Notificaciones (Task 4.2): abre los ajustes de push */}
      <Pressable
        onPress={() => router.push('/settings/notifications')}
        accessibilityRole="button"
        className="mx-4 mt-3 flex-row items-center justify-between rounded-xl bg-white p-4 active:opacity-70 dark:bg-slate-900"
      >
        <View className="flex-1 pr-2">
          <Text className="text-base font-semibold text-slate-900 dark:text-slate-100">
            {t('settings.notif_title')}
          </Text>
          <Text className="mt-0.5 text-sm text-slate-500">{t('settings.notif_entity_help')}</Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color="#64748b" />
      </Pressable>
    </ScrollView>
  );
}
