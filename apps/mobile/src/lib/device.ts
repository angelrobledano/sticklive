import * as Application from 'expo-application';
import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const DEVICE_KEY = 'sticklive.device.id';

/**
 * Identificador de instalación estable para el login con Google (viaja en el
 * state OAuth como `device`; el API lo usa para adoptar la cuenta anónima del
 * dispositivo, misma semántica que el device_id de la web).
 *
 * getAndroidId() es "unavailable" en iOS/web (doc expo-application v57): solo
 * se consulta en Android; en el resto —y si Android no lo devuelve— se usa un
 * UUID v4 (expo-crypto) persistido en SecureStore. SecureStore se borra al
 * desinstalar la app: tras una reinstalación el UUID es nuevo y el dispositivo
 * arranca como cuenta anónima nueva, misma semántica que el device_id del
 * localStorage de la web.
 */
export async function getDeviceId(): Promise<string> {
  if (Platform.OS === 'android') {
    const androidId = Application.getAndroidId();
    if (androidId) return androidId;
  }
  const saved = await SecureStore.getItemAsync(DEVICE_KEY);
  if (saved) return saved;
  const fresh = Crypto.randomUUID();
  await SecureStore.setItemAsync(DEVICE_KEY, fresh);
  return fresh;
}
