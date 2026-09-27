/**
 * Beacon de apertura de notificaciones (#171).
 *
 * El service worker (`public/sw.js`) es un fichero estático y no puede leer
 * `NEXT_PUBLIC_API_URL`, así que postea a la ruta same-origin
 * `/api/push/opened`; el handler de Next reenvía al endpoint real de la API.
 * Aquí se normaliza el cuerpo para reenviar solo los campos que la API acepta.
 */

export interface NotificationBeacon {
  endpoint: string | null;
  type: string;
  url: string;
}

export function buildBeaconBody(input: unknown): NotificationBeacon {
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  return {
    endpoint: typeof o['endpoint'] === 'string' && o['endpoint'] ? o['endpoint'] : null,
    type: typeof o['type'] === 'string' && o['type'] ? o['type'] : 'unknown',
    url: typeof o['url'] === 'string' && o['url'] ? o['url'] : '/',
  };
}
