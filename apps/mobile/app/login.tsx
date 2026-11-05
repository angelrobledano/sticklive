import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSession } from '@/src/context/AuthContext';
import { useLocale } from '@/src/i18n/LocaleContext';
import { authErrorKey } from '@/src/lib/auth-errors';

export default function LoginScreen() {
  const { t } = useLocale();
  const router = useRouter();
  const { token } = useLocalSearchParams<{ token?: string }>();
  const {
    session,
    lastAuthError,
    signInWithGoogle,
    signInWithMagicLinkToken,
    requestMagicLink,
  } = useSession();

  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [verifying, setVerifying] = useState(Boolean(token && !session));
  const [verifyFailed, setVerifyFailed] = useState(false);
  const [signingInGoogle, setSigningInGoogle] = useState(false);

  // Si se abre por deep link o universal link con token (?token=...)
  useEffect(() => {
    if (!token || session) return;
    let active = true;

    signInWithMagicLinkToken(token)
      .then((ok) => {
        if (!active) return;
        if (!ok) {
          setVerifyFailed(true);
        }
      })
      .finally(() => {
        if (active) setVerifying(false);
      });

    return () => {
      active = false;
    };
  }, [token, session, signInWithMagicLinkToken]);

  // Si la sesión pasa a estar activa (por Google, magic link o callback), cerramos el modal de login
  useEffect(() => {
    if (session) {
      if (router.canGoBack()) {
        router.back();
      } else {
        router.replace('/settings');
      }
    }
  }, [session, router]);

  const handleSendEmail = useCallback(async () => {
    const clean = email.trim().toLowerCase();
    if (!clean || !clean.includes('@')) return;

    setSubmitting(true);
    const res = await requestMagicLink(clean);
    setSubmitting(false);

    if (res.ok) {
      setSent(true);
    }
  }, [email, requestMagicLink]);

  const handleGoogle = useCallback(async () => {
    setSigningInGoogle(true);
    try {
      await signInWithGoogle();
    } finally {
      setSigningInGoogle(false);
    }
  }, [signInWithGoogle]);

  // Si está canjeando el token del magic link
  if (verifying) {
    return (
      <View className="flex-1 items-center justify-center bg-slate-50 p-6 dark:bg-slate-950">
        <ActivityIndicator size="large" color="#7a1c30" />
        <Text className="mt-4 text-base font-medium text-slate-700 dark:text-slate-300">
          {t('auth.opening_account')}
        </Text>
      </View>
    );
  }

  // Si el canje del token falló
  if (token && verifyFailed) {
    return (
      <View className="flex-1 items-center justify-center bg-slate-50 p-6 dark:bg-slate-950">
        <Text className="text-center text-lg font-bold text-rose-600 dark:text-rose-400">
          {t(authErrorKey(lastAuthError ?? 'expired'))}
        </Text>
        <Pressable
          onPress={() => router.replace('/login')}
          className="mt-6 rounded-xl bg-rink-passion px-6 py-3 active:opacity-90"
        >
          <Text className="font-semibold text-white">{t('auth.login_title')}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      className="flex-1 bg-slate-50 dark:bg-slate-950"
    >
      <ScrollView contentContainerClassName="p-6">
        <View className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <Text className="text-xl font-bold text-slate-900 dark:text-white">
            {t('auth.login_title')}
          </Text>
          <Text className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {t('auth.login_subtitle')}
          </Text>

          {sent ? (
            <View className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900/50 dark:bg-emerald-950/30">
              <Text className="font-semibold text-emerald-800 dark:text-emerald-300">
                {t('auth.link_sent_title')}
              </Text>
              <Text className="mt-1 text-sm text-emerald-700 dark:text-emerald-400">
                {t('auth.link_sent_body')}
              </Text>
              <Pressable
                onPress={() => setSent(false)}
                className="mt-4 self-start rounded-lg border border-emerald-300 px-3 py-1.5 dark:border-emerald-800"
              >
                <Text className="text-xs font-medium text-emerald-800 dark:text-emerald-300">
                  {t('auth.send_link')}
                </Text>
              </Pressable>
            </View>
          ) : (
            <View className="mt-6">
              <Text className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Email
              </Text>
              <TextInput
                value={email}
                onChangeText={setEmail}
                placeholder="fan@sticklive.eu"
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                className="mt-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />

              <Pressable
                onPress={handleSendEmail}
                disabled={submitting || !email.trim().includes('@')}
                className={`mt-4 items-center justify-center rounded-xl bg-rink-passion py-3 active:opacity-90 ${
                  submitting || !email.trim().includes('@') ? 'opacity-50' : ''
                }`}
              >
                {submitting ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <Text className="font-semibold text-white">{t('auth.send_link')}</Text>
                )}
              </Pressable>

              {lastAuthError ? (
                <Text className="mt-3 text-center text-xs text-rose-500">
                  {t(authErrorKey(lastAuthError))}
                </Text>
              ) : null}
            </View>
          )}

          <View className="my-6 flex-row items-center">
            <View className="flex-1 border-t border-slate-200 dark:border-slate-800" />
            <Text className="mx-3 text-xs uppercase text-slate-400">{t('auth.or_email')}</Text>
            <View className="flex-1 border-t border-slate-200 dark:border-slate-800" />
          </View>

          <Pressable
            onPress={handleGoogle}
            disabled={signingInGoogle}
            className="items-center justify-center rounded-xl border border-slate-200 bg-slate-50 py-3 active:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:active:bg-slate-700"
          >
            {signingInGoogle ? (
              <ActivityIndicator size="small" color="#7a1c30" />
            ) : (
              <Text className="font-semibold text-slate-800 dark:text-slate-200">
                {t('auth.google')}
              </Text>
            )}
          </Pressable>

          <Text className="mt-6 text-center text-xs text-slate-400 dark:text-slate-500">
            {t('auth.privacy')}
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
