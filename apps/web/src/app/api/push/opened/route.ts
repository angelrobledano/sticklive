import { buildBeaconBody } from '@/lib/notification-beacon';

/**
 * Proxy same-origin del beacon de apertura de notificaciones (#171).
 *
 * `public/sw.js` es un fichero estático y no puede leer `NEXT_PUBLIC_API_URL`,
 * así que postea aquí (`/api/push/opened`, same-origin). Reenviamos al endpoint
 * real de la API (`POST /push/opened`), que emite `notification_opened`. Nunca
 * devolvemos error: la analítica no debe romper la apertura de la notificación.
 */
const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3000';

export async function POST(req: Request) {
  let input: unknown = {};
  try {
    input = await req.json();
  } catch {
    /* cuerpo no-JSON: se reenvían los valores por defecto */
  }

  try {
    await fetch(`${API_URL}/push/opened`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildBeaconBody(input)),
      cache: 'no-store',
    });
  } catch {
    /* sin red se pierde el beacon (aceptable) */
  }

  return new Response(null, { status: 204 });
}
