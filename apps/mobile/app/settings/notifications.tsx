import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Switch, Text, View, useColorScheme } from 'react-native';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useSession } from '@/src/context/AuthContext';
import { useLocale } from '@/src/i18n/LocaleContext';
import { useFavorites, useLocalFavorites, type FavoriteKind } from '@/src/hooks/favorites';
import { getDeviceId } from '@/src/lib/device';
import { PLACEHOLDER, resolveFavoriteName } from '@/src/lib/favorite-names';
import {
  getSavedPushToken,
  loadPushPrefs,
  presetKey,
  pushErrorKey,
  registerForPushNotifications,
  savePushPrefs,
  syncPushSubscription,
  type PushPrefs,
} from '@/src/lib/push';
import { capture } from '@/src/lib/analytics';
import type { NotificationPreset } from '@sports/shared-types';

/**
 * Ajustes de notificaciones push (Task 4.2). Paridad con la web
 * (settings + settings/notifications/[kind]): master switch, "silenciar por la
 * noche" y un selector de preset por CADA entidad seguida (favoritos). Cada
 * cambio se guarda en local y el effect de sync lo empuja al API
 * (`POST /push/native/subscribe`) con el estado COMPLETO: token + deviceId +
 * locale + favoritos + prefs.
 *
 * Estrategia de re-sync decidida (entre las dos que autoriza el plan): effect
 * en ESTA pantalla con guard por CONTENIDO (ref), no `onSuccess` de las
 * mutaciones de favoritos. Motivo: al abrir la pantalla se sincroniza el estado
 * actual (auto-curación) y cualquier cambio hecho aquí se empuja al momento;
 * el onSuccess del DELETE /auth/favorites no devuelve la lista resultante, así
 * que reconstruir los favoritos allí exigiría un GET extra y acoplar push a
 * favorites.ts. Matiz documentado: un favorito cambiado FUERA de esta pantalla
 * (estrellas de fichas) llega al servidor al reabrirla.
 *
 * Presets: se ofrecen key_events/results/silent (paridad `UI_PRESETS` de la
 * web: 'complete' es un alias legacy del emisor y ya no se ofrece; si llega
 * guardado se muestra como key_events). Para JUGADORES no hay 'results': los
 * eventos de partido se evalúan sin playerId y ese preset no entregaría nada.
 */

/** Presets que ofrece el selector por tipo (paridad presetsFor de la web). */
const PRESETS_BY_KIND: Record<FavoriteKind, readonly NotificationPreset[]> = {
  team: ['key_events', 'results', 'silent'],
  league: ['key_events', 'results', 'silent'],
  player: ['key_events', 'silent'],
};

/** Normaliza un preset guardado al más cercano que ofrece la UI (web uiPreset). */
function uiPreset(p: NotificationPreset): NotificationPreset {
  return p === 'complete' ? 'key_events' : p;
}

/** Chip de preset (mismo patrón que OptionChip de settings.tsx). */
function PresetChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
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
        className={`text-xs font-semibold ${active ? 'text-white' : 'text-slate-700 dark:text-slate-200'}`}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/** Fila de entidad seguida: nombre + selector de preset (chips). */
function EntityRow({
  kind,
  id,
  name,
  preset,
  onPreset,
}: {
  kind: FavoriteKind;
  id: string;
  name: string;
  preset: NotificationPreset;
  onPreset: (kind: FavoriteKind, id: string, preset: NotificationPreset) => void;
}) {
  const { t } = useLocale();
  return (
    <View className="border-b border-slate-100 px-4 py-3 dark:border-slate-800">
      <Text numberOfLines={1} className="text-sm font-medium text-slate-800 dark:text-slate-200">
        {name}
      </Text>
      <View className="mt-2 flex-row flex-wrap gap-2">
        {PRESETS_BY_KIND[kind].map((p) => (
          <PresetChip
            key={p}
            label={t(`notif_presets.${p}.label`)}
            active={preset === p}
            onPress={() => onPreset(kind, id, p)}
          />
        ))}
      </View>
    </View>
  );
}

/** Fila de interruptor global (master / quietNight), paridad SettingRow web. */
function SettingRow({
  label,
  description,
  value,
  onChange,
}: {
  label: string;
  description: string;
  value: boolean;
  onChange: (next: boolean) => void;
}) {
  const scheme = useColorScheme();
  return (
    <View className="flex-row items-center justify-between gap-3 py-3">
      <View className="flex-1">
        <Text className="text-sm font-medium text-slate-800 dark:text-slate-200">{label}</Text>
        <Text className="mt-0.5 text-xs text-slate-500">{description}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        accessibilityLabel={label}
        trackColor={{ false: scheme === 'dark' ? '#334155' : '#cbd5e1', true: '#991b1b' }}
        thumbColor="#ffffff"
      />
    </View>
  );
}

export default function NotificationsScreen() {
  const { t, locale } = useLocale();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { session } = useSession();
  const authToken = session?.token;

  // Favoritos con el mismo gating que FollowButton: servidor con sesión,
  // estado local (AsyncStorage) anónimo. Ambos hooks montados siempre.
  const server = useFavorites(authToken);
  const local = useLocalFavorites(!authToken);
  const favs = authToken ? server.data : local.data;

  const [pushToken, setPushToken] = useState<string | null>(null);
  const [tokenLoaded, setTokenLoaded] = useState(false);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<PushPrefs | null>(null);
  const [prefsError, setPrefsError] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [registerError, setRegisterError] = useState<string | null>(null);
  const [syncError, setSyncError] = useState(false);

  // Carga inicial: token persistido, deviceId y copia local de prefs.
  useEffect(() => {
    let alive = true;
    void getSavedPushToken()
      .then((tok) => {
        if (alive) setPushToken(tok);
      })
      // Sin token legible la pantalla ofrece "Activar" (reintenta el registro):
      // el fallo queda en consola y la recuperación es el propio botón.
      .catch((err) => console.error('[push] no se pudo leer el token de push', err))
      .finally(() => {
        if (alive) setTokenLoaded(true);
      });
    void getDeviceId()
      .then((id) => {
        if (alive) setDeviceId(id);
      })
      .catch((err) => console.error('[push] no se pudo obtener el deviceId', err));
    void loadPushPrefs()
      .then((p) => {
        if (alive) setPrefs(p);
      })
      .catch((err) => {
        // Storage corrupto: NO sincronizar (pisaría las prefs del servidor con
        // defaults); visible en consola y en pantalla.
        console.error('[push] prefs de notificación ilegibles (storage corrupto)', err);
        if (alive) setPrefsError(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  const handleRegister = useCallback(() => {
    setRegistering(true);
    setRegisterError(null);
    registerForPushNotifications()
      .then((tok) => {
        setPushToken(tok);
        // Analítica (Task 5.1): alta de push nativo (adopción).
        capture('push_registered');
      })
      .catch((err: unknown) => {
        const reason = err instanceof Error ? err.message : String(err);
        setRegisterError(reason);
        console.error('[push] no se pudo registrar el dispositivo para push', err);
        // Analítica (Task 5.1): el fallo también se cuenta, con el motivo del
        // contrato PUSH_ERRORS. El capture NO sustituye al error visible:
        // banner en pantalla + consola siguen (regla "nunca silencioso").
        // El motivo se trunca: los mensajes del SO pueden ser volcados largos
        // y la propiedad de analítica no necesita el texto completo.
        capture('push_failed', { reason: reason.slice(0, 200) });
      })
      .finally(() => setRegistering(false));
  }, []);

  /** Escribe prefs (estado + storage). El sync lo dispara el effect de abajo. */
  const updatePrefs = useCallback((next: PushPrefs) => {
    setPrefs(next);
    void savePushPrefs(next).catch((err) =>
      console.error('[push] no se pudieron guardar las preferencias localmente', err),
    );
  }, []);

  const setEntityPreset = useCallback(
    (kind: FavoriteKind, id: string, preset: NotificationPreset) => {
      if (!prefs) return;
      updatePrefs({ presets: { ...prefs.presets, [presetKey(kind, id)]: preset }, config: prefs.config });
    },
    [prefs, updatePrefs],
  );

  // Sincroniza por CONTENIDO, no por referencia: las queries de favoritos
  // recrean el objeto en cada refetch y un POST por refetch sería spam.
  const lastSyncedRef = useRef<string | null>(null);
  // Un sync nuevo aborta al POST anterior: con cambios rápidos de preferencias
  // sólo importa el último estado (el upsert es idempotente por token) y se
  // evita que una respuesta antigua pise el banner de error del último sync.
  const syncAbortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!pushToken || !deviceId || !prefs || !favs) return;
    const contentKey = JSON.stringify([pushToken, deviceId, locale, authToken ?? null, prefs, favs]);
    if (lastSyncedRef.current === contentKey) return;
    lastSyncedRef.current = contentKey;
    syncAbortRef.current?.abort();
    const ac = new AbortController();
    syncAbortRef.current = ac;
    syncPushSubscription({
      expoPushToken: pushToken,
      deviceId,
      locale,
      favorites: favs,
      prefs,
      authToken,
      signal: ac.signal,
    })
      .then(() => setSyncError(false))
      .catch((err: unknown) => {
        // La cancelación la provoca este mismo flujo (un sync nuevo la sustituye,
        // y ese ya dejó su contentKey en el ref): no es fallo de red ni de API.
        if (err instanceof Error && err.name === 'AbortError') return;
        // Visible, nunca silencioso (regla del repo): banner + consola.
        setSyncError(true);
        console.error('[push] no se pudo sincronizar la suscripción de push', err);
        // Sin esto, un estado cuyo sync falló quedaría marcado como sincronizado
        // para siempre: el guard por contenido lo descartaría aunque el effect
        // vuelva a correr con el mismo contenido (p.ej. refetch de favoritos).
        // Reset a null = el próximo disparo reintenta. NO crea bucle: el ref no
        // es dependencia del effect, sólo re-corre si cambian token/deviceId/
        // prefs/favs/locale/authToken.
        lastSyncedRef.current = null;
      });
  }, [pushToken, deviceId, prefs, favs, locale, authToken]);

  const sections: { kind: FavoriteKind; title: string; ids: string[] }[] = [
    { kind: 'team', title: t('settings.notif_nav_teams'), ids: favs?.teams ?? [] },
    { kind: 'league', title: t('settings.notif_nav_competitions'), ids: favs?.leagues ?? [] },
    { kind: 'player', title: t('settings.notif_nav_players'), ids: favs?.players ?? [] },
  ];
  const total = sections.reduce((n, s) => n + s.ids.length, 0);

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 24 }} className="flex-1 bg-rink-floor dark:bg-rink-floor-dark">
      <Text className="px-4 pt-4 text-2xl font-bold text-slate-900 dark:text-slate-100">
        {t('settings.notif_title')}
      </Text>

      {syncError ? (
        <Text
          className="mx-4 mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-600 dark:bg-red-950/50 dark:text-red-400"
          accessibilityLiveRegion="polite"
        >
          {t('settings.notif_error')}
        </Text>
      ) : null}

      {tokenLoaded && !pushToken ? (
        <View className="mx-4 mt-3 rounded-xl bg-white p-4 dark:bg-slate-900">
          <Text className="text-sm text-slate-500">{t('notif_presets.push_offer_desc')}</Text>
          <Pressable
            onPress={handleRegister}
            disabled={registering}
            className="mt-3 self-start rounded-lg bg-rink-passion px-4 py-2 active:opacity-80 disabled:opacity-50"
          >
            <Text className="font-semibold text-white">{t('settings.notif_activate_btn')}</Text>
          </Pressable>
          {registerError ? (
            <Text
              className="mt-2 text-sm text-red-600 dark:text-red-400"
              accessibilityLiveRegion="polite"
            >
              {t(pushErrorKey(registerError))}
            </Text>
          ) : null}
        </View>
      ) : null}

      {prefsError ? (
        <View className="mx-4 mt-3 rounded-xl bg-white p-4 dark:bg-slate-900">
          <Text className="text-sm text-red-600 dark:text-red-400">{t('settings.notif_error')}</Text>
        </View>
      ) : null}

      {prefs ? (
        <View className="mx-4 mt-3 rounded-xl bg-white px-4 dark:bg-slate-900">
          <SettingRow
            label={t('settings.master')}
            description={t('settings.master_desc')}
            value={prefs.config.master !== false}
            onChange={(next) => updatePrefs({ presets: prefs.presets, config: { ...prefs.config, master: next } })}
          />
          <View className="border-t border-slate-100 dark:border-slate-800">
            <SettingRow
              label={t('settings.quiet')}
              description={t('settings.quiet_desc')}
              value={prefs.config.quietNight !== false}
              onChange={(next) =>
                updatePrefs({ presets: prefs.presets, config: { ...prefs.config, quietNight: next } })
              }
            />
          </View>
        </View>
      ) : null}

      {/* `favs` puede ser undefined mientras cargan los favoritos: sin ese
          check, el estado vacío de "no sigues nada" hace flash durante la carga. */}
      {prefs && favs && total === 0 ? (
        <View className="mx-4 mt-3 rounded-xl bg-white p-4 dark:bg-slate-900">
          <Text className="text-sm text-slate-500">{t('settings.notif_entity_empty')}</Text>
          <Pressable
            onPress={() => router.push('/favorites')}
            className="mt-3 self-start"
            accessibilityRole="link"
          >
            <Text className="text-xs font-semibold text-rink-passion">{t('favorites.manage_favs')}</Text>
          </Pressable>
        </View>
      ) : null}

      {prefs
        ? sections
            .filter((s) => s.ids.length > 0)
            .map((s) => (
              <View key={s.kind} className="mx-4 mt-3 rounded-xl bg-white dark:bg-slate-900">
                <Text className="px-4 pb-1 pt-4 text-xs font-bold uppercase text-slate-500">{s.title}</Text>
                {s.ids.map((id) => (
                  <EntityRow
                    key={id}
                    kind={s.kind}
                    id={id}
                    name={resolveFavoriteName(queryClient, s.kind, id) ?? PLACEHOLDER[s.kind]}
                    preset={uiPreset(prefs.presets[presetKey(s.kind, id)] ?? 'key_events')}
                    onPreset={setEntityPreset}
                  />
                ))}
              </View>
            ))
        : null}
    </ScrollView>
  );
}
