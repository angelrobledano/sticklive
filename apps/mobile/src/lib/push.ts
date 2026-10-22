import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Application from 'expo-application';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { Platform, Vibration } from 'react-native';
import type { FavoriteKind, LocalFavorites } from '@/src/hooks/favorites';
import { apiFetch } from '@/src/lib/api/client';
import { BRAND } from '@sports/brand';
import type { NotificationPreset } from '@sports/shared-types';

/**
 * Push nativo (Task 4.2): registro del token Expo Push, canales Android especializados
 * con sonidos y patrones de vibración propios, y sincronización de preferencias.
 *
 * El contrato lo fija el ETL (push-segmentation.ts, SubPrefs): favoritos por
 * tipo, presets "<tipo>:<id>" → NotificationPreset y config {master, quietNight,
 * soundEnabled, vibrationEnabled, remindersEnabled}.
 */

const PUSH_TOKEN_KEY = 'sticklive.push.token';
const PREFS_KEY = 'sticklive.notif.prefs';

/** Canal Android histórico de respaldo */
export const LIVE_CHANNEL_ID = 'live';

/**
 * Canales de notificación Android especializados con sonidos propios de Stick Live
 * y patrones de vibración háptica reconocibles según la importancia deportiva.
 */
export const NOTIFICATION_CHANNELS = {
  /** Gol de un equipo seguido: prioridad máxima (Heads-Up), sonido de celebración, vibración doble pulso */
  goalFav: {
    id: 'sticklive_goals_fav_v1',
    name: 'Goles a favor (equipo favorito)',
    importance: Notifications.AndroidImportance.MAX,
    sound: 'gol_favor.wav',
    vibrationPattern: [0, 150, 100, 250],
  },
  /** Gol del rival: prioridad alta, sonido de aviso sobrio, vibración pulso largo */
  goalAgainst: {
    id: 'sticklive_goals_against_v1',
    name: 'Goles en contra (rival)',
    importance: Notifications.AndroidImportance.HIGH,
    sound: 'gol_contra.wav',
    vibrationPattern: [0, 400],
  },
  /** Comienzo de partido o periodo: silbato deportivo, dos pulsos suaves */
  matchStart: {
    id: 'sticklive_match_start_v1',
    name: 'Comienzo de partido y periodos',
    importance: Notifications.AndroidImportance.HIGH,
    sound: 'partido_inicio.wav',
    vibrationPattern: [0, 120, 80, 120],
  },
  /** Final del partido o descanso: bocina de pabellón, tres pulsos cortos */
  matchFinal: {
    id: 'sticklive_match_final_v1',
    name: 'Final de partido y descansos',
    importance: Notifications.AndroidImportance.HIGH,
    sound: 'partido_final.wav',
    vibrationPattern: [0, 150, 100, 150, 100, 250],
  },
  /** Recordatorio previo al partido: sonido sutil de aviso, pulso único */
  reminders: {
    id: 'sticklive_reminders_v1',
    name: 'Recordatorios y previa de partido',
    importance: Notifications.AndroidImportance.DEFAULT,
    sound: 'aviso_recordatorio.wav',
    vibrationPattern: [0, 100],
  },
  /** Canal general / legacy */
  live: {
    id: 'live',
    name: 'En directo (general)',
    importance: Notifications.AndroidImportance.MAX,
    sound: 'default',
    vibrationPattern: [0, 250, 250, 250],
  },
} as const;

export type NotificationChannelKey = keyof typeof NOTIFICATION_CHANNELS;

/**
 * Registra o actualiza todos los canales nativos de Android con sus sonidos y
 * patrones de vibración específicos. En Android 13+ se ejecuta antes de solicitar
 * permisos para que el diálogo del sistema se muestre correctamente.
 */
export async function registerNotificationChannels(options?: {
  soundEnabled?: boolean;
  vibrationEnabled?: boolean;
}): Promise<void> {
  if (Platform.OS !== 'android') return;

  const sound = options?.soundEnabled !== false;
  const vibrate = options?.vibrationEnabled !== false;

  for (const ch of Object.values(NOTIFICATION_CHANNELS)) {
    await Notifications.setNotificationChannelAsync(ch.id, {
      name: ch.name,
      importance: ch.importance,
      sound: sound ? ch.sound : undefined,
      enableVibrate: vibrate,
      vibrationPattern: vibrate ? (ch.vibrationPattern as unknown as number[]) : undefined,
      lightColor: BRAND.granate,
      enableLights: true,
      showBadge: false,
    });
  }
}

/**
 * Prueba local interactiva de sonido y vibración háptica para la pantalla de ajustes.
 */
export async function previewNotificationSoundAndVibration(
  channelKey: NotificationChannelKey,
  title: string,
  body: string,
): Promise<void> {
  const channel = NOTIFICATION_CHANNELS[channelKey];
  if (!channel) return;

  if (channel.vibrationPattern && channel.vibrationPattern.length > 0) {
    Vibration.vibrate(channel.vibrationPattern as unknown as number[]);
  }

  await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      sound: channel.sound,
      color: BRAND.granate,
    },
    trigger: Platform.OS === 'android' ? { channelId: channel.id } : null,
  });
}

/**
 * Motivos de error del registro push (strings estables, en español y con
 * prefijo `push_`/dominio propio). Los lanza registerForPushNotifications y
 * `pushErrorKey` los mapea a claves i18n. No renombrar un string sin revisar
 * pushErrorKey y los tests: son parte del contrato pantalla↔lib.
 */
export const PUSH_ERRORS = {
  /** Sin hardware real no hay token (Expo Go/emulador no sirven). */
  requiresPhysicalDevice: 'push_requiere_dispositivo_fisico',
  /** Expo Go no soporta push remoto desde SDK 53: hace falta development build. */
  requiresDevelopmentBuild: 'push_requiere_development_build',
  /** El usuario denegó el permiso de notificaciones del sistema. */
  permissionDenied: 'permiso_notificaciones_denegado',
  /** Sin projectId de EAS el token no puede dirigirse al proyecto. */
  missingEasProjectId: 'falta_projectid_eas_init',
} as const;

/** Código de error de registro → clave i18n (desconocido → error genérico; el
 * motivo real queda en consola, nunca silencioso). Vive en la lib (no en la
 * pantalla) para poder testearlo sin montar componentes nativos. */
export function pushErrorKey(message: string): string {
  if (message.startsWith(PUSH_ERRORS.requiresPhysicalDevice)) return 'settings.notif_requires_device';
  if (message.startsWith(PUSH_ERRORS.requiresDevelopmentBuild)) return 'settings.notif_requires_dev_build';
  if (message.startsWith(PUSH_ERRORS.permissionDenied)) return 'settings.notif_denied_app';
  if (
    message.includes('Firebase') ||
    message.includes('googleServicesFile') ||
    message.includes('E_REGISTRATION_FAILED')
  ) {
    return 'settings.notif_fcm_setup';
  }
  return 'settings.notif_error';
}

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
  /** Configuración global */
  config: {
    master?: boolean;
    quietNight?: boolean;
    soundEnabled?: boolean;
    vibrationEnabled?: boolean;
    remindersEnabled?: boolean;
  };
}

/** Clave de preset del contrato ("<tipo>:<id>"): kind 'league' → 'competition'. */
export function presetKey(kind: FavoriteKind, id: string): string {
  return `${kind === 'league' ? 'competition' : kind}:${id}`;
}

export function defaultPushPrefs(): PushPrefs {
  return {
    presets: {},
    config: {
      master: true,
      quietNight: true,
      soundEnabled: true,
      vibrationEnabled: true,
      remindersEnabled: true,
    },
  };
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
      soundEnabled: cfg['soundEnabled'] !== false,
      vibrationEnabled: cfg['vibrationEnabled'] !== false,
      remindersEnabled: cfg['remindersEnabled'] !== false,
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
 * API): los arrays viajan siempre presentes (lo ausente va vacío, no undefined)
 * y `appVersion` viaja con la versión nativa instalada (expo-application), que
 * el API recorta y persiste. */
export function buildSubscribeBody(input: {
  expoPushToken: string;
  deviceId: string;
  platform: string;
  locale: string;
  favorites: LocalFavorites;
  presets: Record<string, NotificationPreset>;
  config: {
    master?: boolean;
    quietNight?: boolean;
    soundEnabled?: boolean;
    vibrationEnabled?: boolean;
    remindersEnabled?: boolean;
  };
}) {
  return {
    expoPushToken: input.expoPushToken,
    deviceId: input.deviceId,
    platform: input.platform,
    locale: input.locale,
    appVersion: Application.nativeApplicationVersion ?? undefined,
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
  // PRIMERO Expo Go: no soporta push remoto (ni getExpoPushTokenAsync con
  // projectId) desde SDK 53. En un móvil físico con Expo Go, chequear antes
  // `Device.isDevice` daría un motivo engañoso ("falta dispositivo") cuando el
  // problema real es que hace falta un development build.
  if (Constants.appOwnership === 'expo') {
    throw new Error(PUSH_ERRORS.requiresDevelopmentBuild);
  }

  if (!Device.isDevice) {
    // Expo Go no lleva push remoto desde SDK 53 y el emulador no siempre lo
    // soporta: sin hardware real no hay token (doc expo-notifications v57).
    throw new Error(PUSH_ERRORS.requiresPhysicalDevice);
  }

  if (Platform.OS === 'android') {
    // ANTES de pedir permiso: en Android 13 el prompt del sistema no aparece
    // hasta que existe un canal (doc expo-notifications v57). Creamos todos
    // los canales nativos con sus sonidos y vibraciones.
    await registerNotificationChannels();
  }

  const existing = await Notifications.getPermissionsAsync();
  let status = existing.status;
  if (status !== 'granted') {
    status = (await Notifications.requestPermissionsAsync()).status;
  }
  if (status !== 'granted') {
    throw new Error(PUSH_ERRORS.permissionDenied);
  }

  // getExpoPushTokenAsync SOLO se llama con projectId: sin él Expo no puede
  // dirigir el token a este proyecto y el registro sería una ficción.
  const projectId =
    (Constants.expoConfig?.extra?.eas as { projectId?: string } | undefined)?.projectId ??
    Constants.easConfig?.projectId;
  if (!projectId) {
    throw new Error(
      `${PUSH_ERRORS.missingEasProjectId}: falta extra.eas.projectId — ejecuta \`eas init\` en apps/mobile y recompila`,
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
