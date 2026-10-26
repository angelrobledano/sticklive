import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Pressable, ScrollView, Switch, Text, View, useColorScheme } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useSession } from '@/src/context/AuthContext';
import { useLocale } from '@/src/i18n/LocaleContext';
import { useFavoriteName, useFavorites, useLocalFavorites, type FavoriteKind } from '@/src/hooks/favorites';
import { PUSH_PREFS_QUERY_KEY } from '@/src/hooks/useLockScreenLiveMatches';
import { Avatar, playerPhotoUri, teamLogoUri } from '@/src/components/shared/Avatar';
import { clubName } from '@/src/lib/names';
import { getDeviceId } from '@/src/lib/device';
import {
  getSavedPushToken,
  loadPushPrefs,
  presetKey,
  previewNotificationSoundAndVibration,
  pushErrorKey,
  registerForPushNotifications,
  registerNotificationChannels,
  savePushPrefs,
  syncPushSubscription,
  type PushPrefs,
} from '@/src/lib/push';
import { capture } from '@/src/lib/analytics';
import { BRAND } from '@sports/brand';
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

/** Fila de entidad seguida: avatar/icono + nombre + selector de preset (chips) + explicación. */
function EntityRow({
  kind,
  id,
  preset,
  onPreset,
}: {
  kind: FavoriteKind;
  id: string;
  preset: NotificationPreset;
  onPreset: (kind: FavoriteKind, id: string, preset: NotificationPreset) => void;
}) {
  const { t } = useLocale();
  const { name } = useFavoriteName(kind, id);
  const displayName = kind === 'player' ? name : clubName(name) || name;

  const avatar = useMemo(() => {
    if (kind === 'team') {
      return (
        <Avatar
          uri={id ? teamLogoUri(id, 48) : undefined}
          name={displayName}
          size={26}
          variant="team"
        />
      );
    }
    if (kind === 'player') {
      return (
        <Avatar
          uri={id ? playerPhotoUri(id, 48) : undefined}
          name={displayName}
          size={26}
          variant="player"
        />
      );
    }
    return (
      <View className="h-6.5 w-6.5 items-center justify-center rounded-full bg-amber-500/10">
        <Ionicons name="trophy-outline" size={14} color="#eab308" />
      </View>
    );
  }, [kind, id, displayName]);

  const presetDesc =
    kind === 'player'
      ? t(`notif_presets.player.${preset}.desc`)
      : kind === 'league'
      ? t(`notif_presets.league.${preset}.desc`)
      : t(`notif_presets.${preset}.desc`);

  return (
    <View className="border-b border-slate-100 px-4 py-3 dark:border-slate-800">
      <View className="flex-row items-center gap-2.5">
        {avatar}
        <Text numberOfLines={1} className="flex-1 text-sm font-semibold text-slate-800 dark:text-slate-200">
          {displayName}
        </Text>
      </View>
      <View className="mt-2.5 flex-row flex-wrap gap-2">
        {PRESETS_BY_KIND[kind].map((p) => (
          <PresetChip
            key={p}
            label={t(`notif_presets.${p}.label`)}
            active={preset === p}
            onPress={() => onPreset(kind, id, p)}
          />
        ))}
      </View>
      <Text className="mt-2 text-xs text-slate-500 dark:text-slate-400">
        {presetDesc}
      </Text>
    </View>
  );
}

type ShowcaseTab = 'teams' | 'players' | 'leagues';

/** Tarjeta interactiva y atractiva de previsualización de notificaciones tipo lockscreen. */
function NotificationShowcaseCard() {
  const { t } = useLocale();
  const [activeTab, setActiveTab] = useState<ShowcaseTab>('teams');

  return (
    <View className="mx-4 mt-3 rounded-2xl bg-white p-4 shadow-xs dark:bg-slate-900">
      <View className="flex-row items-center justify-between">
        <View className="flex-1 pr-2">
          <Text className="text-sm font-bold text-slate-900 dark:text-slate-100">
            {t('notif_presets.showcase.title')}
          </Text>
          <Text className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            {t('notif_presets.showcase.subtitle')}
          </Text>
        </View>
        <View className="h-8 w-8 items-center justify-center rounded-full bg-rose-50 dark:bg-rose-950/40">
          <Ionicons name="notifications" size={16} color={BRAND.granate} />
        </View>
      </View>

      {/* Selector de categoría (Equipos, Jugadores, Ligas) */}
      <View className="mt-3.5 flex-row rounded-xl bg-slate-100 p-1 dark:bg-slate-800" accessibilityRole="tablist">
        <Pressable
          onPress={() => setActiveTab('teams')}
          accessibilityRole="tab"
          accessibilityState={{ selected: activeTab === 'teams' }}
          hitSlop={8}
          className={`flex-1 min-h-[48px] flex-row items-center justify-center gap-1.5 rounded-lg py-2.5 ${
            activeTab === 'teams' ? 'bg-white shadow-xs dark:bg-slate-900' : ''
          }`}
        >
          <Ionicons
            name="shield-outline"
            size={13}
            color={activeTab === 'teams' ? BRAND.granate : '#64748b'}
          />
          <Text
            className={`text-xs font-bold ${
              activeTab === 'teams'
                ? 'text-rink-passion dark:text-rose-400'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            {t('notif_presets.showcase.tab_teams')}
          </Text>
        </Pressable>

        <Pressable
          onPress={() => setActiveTab('players')}
          accessibilityRole="tab"
          accessibilityState={{ selected: activeTab === 'players' }}
          hitSlop={8}
          className={`flex-1 min-h-[48px] flex-row items-center justify-center gap-1.5 rounded-lg py-2.5 ${
            activeTab === 'players' ? 'bg-white shadow-xs dark:bg-slate-900' : ''
          }`}
        >
          <Ionicons
            name="person-outline"
            size={13}
            color={activeTab === 'players' ? BRAND.granate : '#64748b'}
          />
          <Text
            className={`text-xs font-bold ${
              activeTab === 'players'
                ? 'text-rink-passion dark:text-rose-400'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            {t('notif_presets.showcase.tab_players')}
          </Text>
        </Pressable>

        <Pressable
          onPress={() => setActiveTab('leagues')}
          accessibilityRole="tab"
          accessibilityState={{ selected: activeTab === 'leagues' }}
          hitSlop={8}
          className={`flex-1 min-h-[48px] flex-row items-center justify-center gap-1.5 rounded-lg py-2.5 ${
            activeTab === 'leagues' ? 'bg-white shadow-xs dark:bg-slate-900' : ''
          }`}
        >
          <Ionicons
            name="trophy-outline"
            size={13}
            color={activeTab === 'leagues' ? BRAND.granate : '#64748b'}
          />
          <Text
            className={`text-xs font-bold ${
              activeTab === 'leagues'
                ? 'text-rink-passion dark:text-rose-400'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            {t('notif_presets.showcase.tab_leagues')}
          </Text>
        </Pressable>
      </View>

      {/* Notificaciones de muestra según la pestaña seleccionada */}
      {activeTab === 'teams' && (
        <View className="mt-1">
          <MockPushCard
            time={t('notif_presets.showcase.time_now')}
            badge={t('notif_presets.showcase.badge_live')}
            title={t('notif_presets.showcase.team_goal_title')}
            body={t('notif_presets.showcase.team_goal_body')}
            liveScore="BAR 1 - 0 LIC · Min. 14'"
            icon="shield"
          />
          <MockPushCard
            time={t('notif_presets.showcase.time_5m')}
            badge={t('notif_presets.showcase.badge_final')}
            title={t('notif_presets.showcase.team_final_title')}
            body={t('notif_presets.showcase.team_final_body')}
            icon="flag"
          />
          <View className="mt-2.5 rounded-lg bg-slate-50 p-2.5 dark:bg-slate-800/60">
            <Text className="text-[11px] leading-relaxed text-slate-600 dark:text-slate-300">
              💡 {t('notif_presets.showcase.note_teams')}
            </Text>
          </View>
        </View>
      )}

      {activeTab === 'players' && (
        <View className="mt-1">
          <MockPushCard
            time={t('notif_presets.showcase.time_now')}
            badge={t('notif_presets.showcase.badge_goal')}
            title={t('notif_presets.showcase.player_goal_title')}
            body={t('notif_presets.showcase.player_goal_body')}
            liveScore="BAR 2 - 1 NOI · Min. 32'"
            icon="person"
          />
          <MockPushCard
            time={t('notif_presets.showcase.time_10m')}
            badge={t('notif_presets.showcase.badge_blue_card')}
            title={t('notif_presets.showcase.player_card_title')}
            body={t('notif_presets.showcase.player_card_body')}
            icon="alert-circle"
          />
          <View className="mt-2.5 rounded-lg bg-slate-50 p-2.5 dark:bg-slate-800/60">
            <Text className="text-[11px] leading-relaxed text-slate-600 dark:text-slate-300">
              💡 {t('notif_presets.showcase.note_players')}
            </Text>
          </View>
        </View>
      )}

      {activeTab === 'leagues' && (
        <View className="mt-1">
          <MockPushCard
            time={t('notif_presets.showcase.time_friday')}
            badge={t('notif_presets.showcase.badge_matchday')}
            title={t('notif_presets.showcase.league_start_title')}
            body={t('notif_presets.showcase.league_start_body')}
            icon="trophy"
          />
          <MockPushCard
            time={t('notif_presets.showcase.time_sunday')}
            badge={t('notif_presets.showcase.badge_results')}
            title={t('notif_presets.showcase.league_end_title')}
            body={t('notif_presets.showcase.league_end_body')}
            icon="stats-chart"
          />
          <View className="mt-2.5 rounded-lg bg-slate-50 p-2.5 dark:bg-slate-800/60">
            <Text className="text-[11px] leading-relaxed text-slate-600 dark:text-slate-300">
              💡 {t('notif_presets.showcase.note_leagues')}
            </Text>
          </View>
        </View>
      )}

      {/* Explicación de los 3 tipos para la categoría actual */}
      <View className="mt-3.5 border-t border-slate-100 pt-3 dark:border-slate-800">
        <View className="flex-row items-start">
          <View className="mr-2 mt-1.5 h-2 w-2 rounded-full bg-rink-passion" />
          <View className="flex-1">
            <Text className="text-xs font-semibold text-slate-800 dark:text-slate-200">
              {t('notif_presets.key_events.label')}
              {activeTab === 'teams'
                ? t('notif_presets.showcase.suffix_teams')
                : activeTab === 'players'
                ? t('notif_presets.showcase.suffix_players')
                : t('notif_presets.showcase.suffix_leagues')}
            </Text>
            <Text className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              {activeTab === 'players'
                ? t('notif_presets.player.key_events.desc')
                : activeTab === 'leagues'
                ? t('notif_presets.league.key_events.desc')
                : t('notif_presets.key_events.desc')}
            </Text>
          </View>
        </View>

        {activeTab !== 'players' && (
          <View className="mt-2.5 flex-row items-start">
            <View className="mr-2 mt-1.5 h-2 w-2 rounded-full bg-slate-400" />
            <View className="flex-1">
              <Text className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                {t('notif_presets.results.label')}
              </Text>
              <Text className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                {activeTab === 'leagues'
                  ? t('notif_presets.league.results.desc')
                  : t('notif_presets.results.desc')}
              </Text>
            </View>
          </View>
        )}

        <View className="mt-2.5 flex-row items-start">
          <View className="mr-2 mt-1.5 h-2 w-2 rounded-full bg-slate-300 dark:bg-slate-600" />
          <View className="flex-1">
            <Text className="text-xs font-semibold text-slate-800 dark:text-slate-200">
              {t('notif_presets.silent.label')}
            </Text>
            <Text className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              {activeTab === 'players'
                ? t('notif_presets.player.silent.desc')
                : activeTab === 'leagues'
                ? t('notif_presets.league.silent.desc')
                : t('notif_presets.silent.desc')}
            </Text>
          </View>
        </View>
      </View>

      {/* Probador interactivo de sonidos deportivos y vibración */}
      <View className="mt-4 border-t border-slate-100 pt-3 dark:border-slate-800">
        <View className="mb-2.5 flex-row items-center justify-between">
          <Text className="text-xs font-bold text-slate-800 dark:text-slate-200">
            {t('settings.test_sounds_title')}
          </Text>
          <Ionicons name="volume-medium-outline" size={14} color="#64748b" />
        </View>
        <View className="flex-row flex-wrap gap-2">
          <Pressable
            onPress={() => void previewNotificationSoundAndVibration('goalFav', '¡GOL DE BARÇA!', 'Pablo Álvarez pone el 2 - 1 (14\')')}
            accessibilityRole="button"
            className="flex-row items-center gap-1.5 rounded-full bg-rose-50 px-3 py-2 active:opacity-70 dark:bg-rose-950/40"
          >
            <Ionicons name="volume-high" size={12} color={BRAND.granate} />
            <Text className="text-xs font-semibold text-rink-passion dark:text-rose-400">
              {t('settings.test_sound_goal_fav')}
            </Text>
          </Pressable>

          <Pressable
            onPress={() => void previewNotificationSoundAndVibration('goalAgainst', '¡Gol de Liceo!', 'Dava Torres pone el 2 - 2 (18\')')}
            accessibilityRole="button"
            className="flex-row items-center gap-1.5 rounded-full bg-slate-100 px-3 py-2 active:opacity-70 dark:bg-slate-800"
          >
            <Ionicons name="volume-low" size={12} color="#64748b" />
            <Text className="text-xs font-semibold text-slate-700 dark:text-slate-200">
              {t('settings.test_sound_goal_against')}
            </Text>
          </Pressable>

          <Pressable
            onPress={() => void previewNotificationSoundAndVibration('matchStart', '¡Comienza el partido!', 'Barça vs Deportivo Liceo')}
            accessibilityRole="button"
            className="flex-row items-center gap-1.5 rounded-full bg-slate-100 px-3 py-2 active:opacity-70 dark:bg-slate-800"
          >
            <Ionicons name="play" size={12} color="#64748b" />
            <Text className="text-xs font-semibold text-slate-700 dark:text-slate-200">
              {t('settings.test_sound_start')}
            </Text>
          </Pressable>

          <Pressable
            onPress={() => void previewNotificationSoundAndVibration('matchFinal', 'FINAL · OK Liga', 'Barça 3 - 2 Deportivo Liceo')}
            accessibilityRole="button"
            className="flex-row items-center gap-1.5 rounded-full bg-slate-100 px-3 py-2 active:opacity-70 dark:bg-slate-800"
          >
            <Ionicons name="flag" size={12} color="#64748b" />
            <Text className="text-xs font-semibold text-slate-700 dark:text-slate-200">
              {t('settings.test_sound_final')}
            </Text>
          </Pressable>

          <Pressable
            onPress={() => void previewNotificationSoundAndVibration('reminders', 'Recordatorio de partido', 'Barça vs Reus en 15 minutos')}
            accessibilityRole="button"
            className="flex-row items-center gap-1.5 rounded-full bg-slate-100 px-3 py-2 active:opacity-70 dark:bg-slate-800"
          >
            <Ionicons name="time-outline" size={12} color="#64748b" />
            <Text className="text-xs font-semibold text-slate-700 dark:text-slate-200">
              {t('settings.test_sound_reminder')}
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

/** Tarjeta individual de previsualización de push notification. */
function MockPushCard({
  time,
  title,
  body,
  badge,
  liveScore,
  icon = 'shield',
}: {
  time: string;
  title: string;
  body: string;
  badge?: string;
  liveScore?: string;
  icon?: keyof typeof Ionicons.glyphMap;
}) {
  return (
    <View className="mt-2.5 rounded-2xl border border-slate-200/90 bg-slate-50/90 p-3 shadow-xs dark:border-slate-800 dark:bg-slate-800/80">
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center gap-1.5">
          <View
            className="h-4.5 w-4.5 items-center justify-center rounded-[5px]"
            style={{ backgroundColor: BRAND.granate }}
          >
            <Ionicons name={icon} size={10} color="#ffffff" />
          </View>
          <Text className="text-[10px] font-black tracking-wider text-slate-500 dark:text-slate-400">
            STICK LIVE
          </Text>
          <Text className="text-[10px] text-slate-400">•</Text>
          <Text className="text-[10px] font-medium text-slate-400">{time}</Text>
        </View>
        {badge ? (
          <View className="rounded bg-rose-50 px-1.5 py-0.5 dark:bg-rose-950/70">
            <Text className="text-[9px] font-bold text-rink-passion dark:text-rose-400">
              {badge}
            </Text>
          </View>
        ) : null}
      </View>

      <Text className="mt-1.5 text-xs font-bold text-slate-900 dark:text-slate-100">
        {title}
      </Text>
      <Text className="mt-0.5 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
        {body}
      </Text>

      {liveScore ? (
        <View className="mt-2 flex-row items-center justify-between rounded-lg border border-slate-200/60 bg-white px-2 py-1 dark:border-slate-700/60 dark:bg-slate-900/90">
          <View className="flex-row items-center gap-1.5">
            <View className="h-2 w-2 rounded-full bg-emerald-500" />
            <Text className="font-mono text-[10px] font-bold text-slate-800 dark:text-slate-200">
              {liveScore}
            </Text>
          </View>
          <Text className="text-[9px] font-semibold text-slate-400">
            hockey patines
          </Text>
        </View>
      ) : null}
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
        trackColor={{ false: scheme === 'dark' ? '#334155' : '#cbd5e1', true: BRAND.granate }}
        thumbColor="#ffffff"
      />
    </View>
  );
}

export default function NotificationsScreen() {
  const { t, locale } = useLocale();
  const router = useRouter();
  const qc = useQueryClient();
  const { session } = useSession();
  const insets = useSafeAreaInsets();
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
  const [systemStatus, setSystemStatus] = useState<Notifications.PermissionStatus | null>(null);

  // Carga inicial: token persistido, deviceId, estado de permisos y copia local de prefs.
  useEffect(() => {
    let alive = true;
    void Notifications.getPermissionsAsync()
      .then((p) => {
        if (alive) setSystemStatus(p.status);
      })
      .catch((err) => console.error('[push] no se pudo leer permiso del sistema', err));
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
        setSystemStatus(Notifications.PermissionStatus.GRANTED);
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
  const updatePrefs = useCallback(
    (next: PushPrefs) => {
      setPrefs(next);
      qc.setQueryData(PUSH_PREFS_QUERY_KEY, next);
      void registerNotificationChannels({
        soundEnabled: next.config.soundEnabled,
        vibrationEnabled: next.config.vibrationEnabled,
      });
      void savePushPrefs(next).catch((err) =>
        console.error('[push] no se pudieron guardar las preferencias localmente', err),
      );
    },
    [qc],
  );

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
    <ScrollView
      contentContainerStyle={{ paddingBottom: Math.max(insets.bottom + 24, 32) }}
      className="flex-1 bg-rink-floor dark:bg-rink-floor-dark"
    >
      {systemStatus === 'denied' ? (
        <View className="mx-4 mt-3 rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/50 dark:bg-amber-950/40">
          <View className="flex-row items-center gap-2">
            <Ionicons name="alert-circle" size={16} color="#d97706" />
            <Text className="flex-1 text-xs font-semibold text-amber-900 dark:text-amber-200">
              {t('settings.notif_denied_app')}
            </Text>
          </View>
          <Pressable
            onPress={() => void Linking.openSettings()}
            className="mt-2.5 flex-row items-center gap-1.5 self-start rounded-lg bg-amber-600 px-3 py-1.5 active:opacity-80"
            accessibilityRole="button"
          >
            <Ionicons name="open-outline" size={12} color="#ffffff" />
            <Text className="text-xs font-semibold text-white">
              {t('settings.android_channels_btn')}
            </Text>
          </Pressable>
        </View>
      ) : null}

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
              label={t('settings.sound')}
              description={t('settings.sound_desc')}
              value={prefs.config.soundEnabled !== false}
              onChange={(next) =>
                updatePrefs({ presets: prefs.presets, config: { ...prefs.config, soundEnabled: next } })
              }
            />
          </View>
          <View className="border-t border-slate-100 dark:border-slate-800">
            <SettingRow
              label={t('settings.vibration')}
              description={t('settings.vibration_desc')}
              value={prefs.config.vibrationEnabled !== false}
              onChange={(next) =>
                updatePrefs({ presets: prefs.presets, config: { ...prefs.config, vibrationEnabled: next } })
              }
            />
          </View>
          <View className="border-t border-slate-100 dark:border-slate-800">
            <SettingRow
              label={t('settings.reminders')}
              description={t('settings.reminders_desc')}
              value={prefs.config.remindersEnabled !== false}
              onChange={(next) =>
                updatePrefs({ presets: prefs.presets, config: { ...prefs.config, remindersEnabled: next } })
              }
            />
          </View>
          <View className="border-t border-slate-100 dark:border-slate-800">
            <SettingRow
              label={t('settings.live_lockscreen')}
              description={t('settings.live_lockscreen_desc')}
              value={prefs.config.liveLockscreenEnabled !== false}
              onChange={(next) =>
                updatePrefs({ presets: prefs.presets, config: { ...prefs.config, liveLockscreenEnabled: next } })
              }
            />
          </View>
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

      {/* Muestra interactiva de notificaciones (Equipos, Jugadores, Ligas) */}
      <NotificationShowcaseCard />

      {/* Canales y permisos del sistema Android */}
      <View className="mx-4 mt-3 rounded-xl bg-white p-4 dark:bg-slate-900">
        <View className="flex-row items-center gap-2">
          <Ionicons name="settings-outline" size={16} color="#64748b" />
          <Text className="text-xs font-bold uppercase tracking-wider text-slate-500">
            {t('settings.android_channels_title')}
          </Text>
        </View>
        <Text className="mt-1.5 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
          {t('settings.android_channels_desc')}
        </Text>
        <Pressable
          onPress={() => void Linking.openSettings()}
          className="mt-3 flex-row items-center gap-1.5 self-start rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 active:opacity-70 dark:border-slate-700 dark:bg-slate-800"
          accessibilityRole="button"
        >
          <Ionicons name="open-outline" size={13} color="#64748b" />
          <Text className="text-xs font-semibold text-slate-700 dark:text-slate-200">
            {t('settings.android_channels_btn')}
          </Text>
        </Pressable>
      </View>

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
