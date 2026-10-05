import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import type { FavoriteKind, LocalFavorites } from '@/src/hooks/favorites';
import { apiFetch } from '@/src/lib/api/client';
import type { NotificationPreset } from '@sports/shared-types';

/**
 * Push nativo (Task 4.2): registro del token Expo Push, canal Android 'live' y
 * sincronización de preferencias con `POST/DELETE /push/native/subscribe`.
 *
 * El contrato lo fija el ETL (push-segmentation.ts, SubPrefs): favoritos por
 * tipo, presets "<tipo>:<id>" → NotificationPreset (ojo: la LIGA es favorito
 * kind 'league' pero clave 'competition:<id>') y config {master, quietNight}
 * donde `false` excluye (master de todo; quietNight del resumen matinal).
 */

const PUSH_TOKEN_KEY = 'sticklive.push.token';
const PREFS_KEY = 'sticklive.notif.prefs';

/** Canal Android de los avisos en directo (se crea antes de pedir permiso:
 * en Android 13 el prompt del sistema no aparece sin un canal, doc expo-
 * notifications v57). El emisor (Task 4.3) debe dirigir aquí los envíos. */
export const LIVE_CHANNEL_ID = 'live';

/** Mismo catálogo que VALID_PRESETS del API (routes/push.ts). */
const VALID_PRESETS: ReadonlySet<string> = new Set([
  'complete',
  'key_events',
  'results',
  'silent',
]);

export interface PushPrefs {
  /** Mapa presetKey(kind, id) → preset. Entidad seguida sin entrada = key_events. */
  presets: Record<string, NotificationPreset>;
  /** `false` excluye: master de TODO, quietNight del resumen matinal (ETL). */
  config: { master?: boolean; quietNight?: boolean };
}

/** Clave de preset del contrato ("<tipo>:<id>"): kind 'league' → 'competition'. */
export function presetKey(kind: FavoriteKind, id: string): string {
  return `${kind === 'league' ? 'competition' : kind}:${id}`;
}

export function defaultPushPrefs(): PushPrefs {
  return { presets: {}, config: { master: true, quietNight: true } };
}

/**
 * Normaliza lo leído de storage: completa los booleanos ausentes (ausente =
 * activado, misma semántica que el ETL) y descarta presets fuera del catálogo.
 * Un JSON corrupto NO se traga (regla del repo): rechaza y el llamador NO debe
 * sincronizar — si lo hiciera con defaults, pisaría las elecciones del usuario
 * en el servidor.
 */
export function parsePushPrefs(raw: string | null): PushPrefs {
  if (raw === null) return defaultPushPrefs();
  const data = JSON.parse(raw) as { presets?: unknown; config?: unknown };
  const presets: Record<string, NotificationPreset> = {};
  if (data.presets && typeof data.presets === 'object') {
    for (const [k, v] of Object.entries(data.presets)) {
      if (typeof v === 'string' && VALID_PRESETS.has(v)) presets[k] = v as NotificationPreset;
    }
  }
  const cfg = (data.config && typeof data.config === 'object' ? data.config : {}) as Record<string, unknown>;
  return {
    presets,
    config: {
      master: cfg['master'] !== false,
      quietNight: cfg['quietNight'] !== false,
    },
  };
}

/** Copia local de las preferencias (fuente de verdad: la fila push_tokens). */
export async function loadPushPrefs(): Promise<PushPrefs> {
  return parsePushPrefs(await AsyncStorage.getItem(PREFS_KEY));
}

export async function savePushPrefs(prefs: PushPrefs): Promise<void> {
  await AsyncStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}

/** Mapeo PURO al contrato de POST /push/native/subscribe (NativeSubBody del
 * API): los arrays viajan siempre presentes (lo ausente va vacío, no undefined). */
export function buildSubscribeBody(input: {
  expoPushToken: string;
  deviceId: string;
  platform: string;
  locale: string;
  favorites: LocalFavorites;
  presets: Record<string, NotificationPreset>;
  config: { master?: boolean; quietNight?: boolean };
}) {
  return {
    expoPushToken: input.expoPushToken,
    deviceId: input.deviceId,
    platform: input.platform,
    locale: input.locale,
    favTeams: input.favorites.teams,
    favLeagues: input.favorites.leagues,
    favPlayers: input.favorites.players,
    presets: input.presets,
    config: input.config,
  };
}

/**
 * Registra el dispositivo para push y devuelve el Expo Push token (queda
 * persistido en SecureStore para las syncs siguientes). Lanza con un motivo
 * explícito si no hay dispositivo físico, el permiso se deniega o falta el
 * projectId de EAS (`eas init`): los fallos nunca son silenciosos.
 */
export async function registerForPushNotifications(): Promise<string> {
  if (!Device.isDevice) {
    // Expo Go no lleva push remoto desde SDK 53 y el emulador no siempre lo
    // soporta: sin hardware real no hay token (doc expo-notifications v57).
    throw new Error('push_requiere_dispositivo_fisico');
  }

  if (Platform.OS === 'android') {
    // ANTES de pedir permiso: en Android 13 el prompt del sistema no aparece
    // hasta que existe un canal (doc expo-notifications v57).
    await Notifications.setNotificationChannelAsync(LIVE_CHANNEL_ID, {
      name: 'En directo',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#991b1b',
    });
  }

  const existing = await Notifications.getPermissionsAsync();
  let status = existing.status;
  if (status !== 'granted') {
    status = (await Notifications.requestPermissionsAsync()).status;
  }
  if (status !== 'granted') {
    throw new Error('permiso_notificaciones_denegado');
  }

  // getExpoPushTokenAsync SOLO se llama con projectId: sin él Expo no puede
  // dirigir el token a este proyecto y el registro sería una ficción.
  const projectId =
    (Constants.expoConfig?.extra?.eas as { projectId?: string } | undefined)?.projectId ??
    Constants.easConfig?.projectId;
  if (!projectId) {
    throw new Error(
      'falta_projectid_eas_init: falta extra.eas.projectId — ejecuta `eas init` en apps/mobile y recompila',
    );
  }

  const token = await Notifications.getExpoPushTokenAsync({ projectId });
  await SecureStore.setItemAsync(PUSH_TOKEN_KEY, token.data);
  return token.data;
}

/** Token registrado en este dispositivo (null si aún no se registró). */
export async function getSavedPushToken(): Promise<string | null> {
  return SecureStore.getItemAsync(PUSH_TOKEN_KEY);
}

/**
 * Sincroniza el estado COMPLETO de la suscripción (favoritos + prefs + locale)
 * con el API. Upsert idempotente por expo_push_token: la fila siempre refleja
 * el último estado del cliente. Con sesión activa viaja Bearer para asociar el
 * token a la cuenta (segmentación por usuario).
 */
export async function syncPushSubscription(vars: {
  expoPushToken: string;
  deviceId: string;
  locale: string;
  favorites: LocalFavorites;
  prefs: PushPrefs;
  authToken?: string | null;
  /** Cancela el POST en curso si la pantalla inicia otro sync (review 4.2). */
  signal?: AbortSignal;
}): Promise<void> {
  await apiFetch('/push/native/subscribe', {
    method: 'POST',
    token: vars.authToken ?? undefined,
    signal: vars.signal,
    body: buildSubscribeBody({
      expoPushToken: vars.expoPushToken,
      deviceId: vars.deviceId,
      platform: Platform.OS,
      locale: vars.locale,
      favorites: vars.favorites,
      presets: vars.prefs.presets,
      config: vars.prefs.config,
    }),
  });
}

/**
 * Da de baja el token (DELETE con ownership deviceId OR user del Bearer).
 * Hoy ninguna pantalla lo llama: apagar el master switch es config.master
 * `false` (paridad con la web: la fila sobrevive y conserva las preferencias).
 * Qeda para el flujo de "borrar suscripción" que evalúe M5.
 */
export async function disablePushSubscription(
  expoPushToken: string,
  deviceId: string,
  authToken?: string | null,
): Promise<void> {
  await apiFetch('/push/native/subscribe', {
    method: 'DELETE',
    token: authToken ?? undefined,
    body: { expoPushToken, deviceId },
  });
}
