import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildSubscribeBody,
  loadPushPrefs,
  presetKey,
  pushErrorKey,
  registerForPushNotifications,
} from './push';

// Los módulos NATIVOS no existen en vitest (node): mocks mínimos para que la
// importación de './push' no explote (patrón del repo: session.test.ts).
// expo-constants es MUTABLE para simular Expo Go vs development build.
const { expoConstants, storage } = vi.hoisted(() => ({
  expoConstants: {
    expoConfig: null,
    easConfig: null,
    appOwnership: 'bare',
  },
  storage: new Map<string, string>(),
}));
vi.mock('expo-notifications', () => ({ AndroidImportance: { MAX: 5 } }));
vi.mock('expo-device', () => ({ isDevice: true }));
vi.mock('expo-constants', () => ({ default: expoConstants }));
vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(async () => undefined),
}));
vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (k: string) => storage.get(k) ?? null),
    setItem: vi.fn(async (k: string, v: string) => void storage.set(k, v)),
  },
}));

describe('presetKey', () => {
  it('mapea kind a la clave del contrato del ETL (liga → competition:)', () => {
    // El favorito kind es 'league' (nomenclatura del API) pero la clave de
    // preset es 'competition:<id>' (SubPrefs de push-segmentation.ts).
    expect(presetKey('team', 'a')).toBe('team:a');
    expect(presetKey('league', 'b')).toBe('competition:b');
    expect(presetKey('player', 'c')).toBe('player:c');
  });
});

describe('buildSubscribeBody', () => {
  it('mapea favoritos+presets+config al contrato de SubPrefs del ETL', () => {
    const body = buildSubscribeBody({
      expoPushToken: 'ExponentPushToken[abc123456789]',
      deviceId: 'dev-1',
      platform: 'android',
      locale: 'es',
      favorites: { teams: ['t1'], leagues: ['l1'], players: ['p1'] },
      presets: { 'team:t1': 'key_events', 'competition:l1': 'silent', 'player:p1': 'results' },
      config: { master: true, quietNight: false },
    });
    expect(body).toEqual({
      expoPushToken: 'ExponentPushToken[abc123456789]',
      deviceId: 'dev-1',
      platform: 'android',
      locale: 'es',
      favTeams: ['t1'],
      favLeagues: ['l1'],
      favPlayers: ['p1'],
      presets: { 'team:t1': 'key_events', 'competition:l1': 'silent', 'player:p1': 'results' },
      config: { master: true, quietNight: false },
    });
  });

  it('no inventa favoritos: lo que no hay va vacío, no undefined', () => {
    const body = buildSubscribeBody({
      expoPushToken: 'ExponentPushToken[abc123456789]',
      deviceId: 'dev-1',
      platform: 'android',
      locale: 'en',
      favorites: { teams: [], leagues: [], players: [] },
      presets: {},
      config: {},
    });
    expect(body.favTeams).toEqual([]);
    expect(body.favLeagues).toEqual([]);
    expect(body.favPlayers).toEqual([]);
  });
});

describe('loadPushPrefs', () => {
  beforeEach(() => storage.clear());

  it('sin datos guardados devuelve los valores por defecto (todo activado)', async () => {
    expect(await loadPushPrefs()).toEqual({
      presets: {},
      config: { master: true, quietNight: true },
    });
  });

  it('redondea lo guardado y completa los booleanos ausentes (ausente = activado)', async () => {
    storage.set(
      'sticklive.notif.prefs',
      JSON.stringify({ presets: { 'team:x': 'silent' }, config: { master: false } }),
    );
    expect(await loadPushPrefs()).toEqual({
      presets: { 'team:x': 'silent' },
      config: { master: false, quietNight: true },
    });
  });

  it('descarta presets con valores fuera del catálogo (mismo filtro que el API)', async () => {
    storage.set(
      'sticklive.notif.prefs',
      JSON.stringify({ presets: { 'team:x': 'bogus', 'player:y': 'results' }, config: {} }),
    );
    expect((await loadPushPrefs()).presets).toEqual({ 'player:y': 'results' });
  });

  it('un JSON corrupto NO se traga: rechaza (regla del repo), el servidor queda intacto', async () => {
    storage.set('sticklive.notif.prefs', '{corrupto');
    await expect(loadPushPrefs()).rejects.toThrow();
  });
});

describe('pushErrorKey', () => {
  it('mapea cada error conocido a su clave i18n (el detalle tras el prefijo no rompe el mapeo)', () => {
    expect(pushErrorKey('push_requiere_dispositivo_fisico')).toBe('settings.notif_requires_device');
    expect(pushErrorKey('push_requiere_development_build')).toBe('settings.notif_requires_dev_build');
    expect(pushErrorKey('permiso_notificaciones_denegado')).toBe('settings.notif_denied_app');
    // El motivo de projectId viaja con detalle técnico como sufijo: genérico.
    expect(pushErrorKey('falta_projectid_eas_init: falta extra.eas.projectId')).toBe('settings.notif_error');
    expect(pushErrorKey('otro_error_inesperado')).toBe('settings.notif_error');
  });
});

describe('registerForPushNotifications en Expo Go', () => {
  it('rechaza con un motivo explícito pidiendo development build (push remoto no soportado desde SDK 53)', async () => {
    expoConstants.appOwnership = 'expo';
    try {
      // Debe lanzar ANTES de crear el canal o pedir permisos: en Expo Go nada
      // de eso lleva a un token útil.
      await expect(registerForPushNotifications()).rejects.toThrow('push_requiere_development_build');
    } finally {
      expoConstants.appOwnership = 'bare';
    }
  });
});
