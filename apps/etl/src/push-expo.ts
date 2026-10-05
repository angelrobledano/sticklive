/**
 * Canal NATIVO (Expo Push → FCM/APNs) del emisor dual — Task 4.3.
 *
 * Misma filosofía que deliver() del dispatcher web: errores EXPLÍCITOS (log),
 * poda de tokens muertos, nunca silencioso. Es ADITIVO: el canal web no se
 * toca, push-dispatcher.ts decide a quién le toca y llama aquí.
 *
 * Contrato del API v2 de Expo (docs.expo.dev/push-notifications/sending-notifications):
 *   · /push/send admite un array de ≤100 mensajes por POST (400 si se pasa).
 *   · Un envío aceptado (`status: 'ok'`) NO garantiza entrega: el diagnóstico
 *     llega por /push/getReceipts (≤1000 ids por POST), donde DeviceNotRegistered
 *     marca el token para podar.
 */
import { db } from '@sports/db';
import { createLogger } from '@sports/logger';

const log = createLogger({ service: 'push-expo' });
const EXPO_API = 'https://exp.host/--/api/v2/push/send';
const EXPO_RECEIPTS = 'https://exp.host/--/api/v2/push/getReceipts';
const SEND_CHUNK = 100;       // límite duro del endpoint /push/send
const RECEIPT_CHUNK = 1000;   // límite duro del endpoint /push/getReceipts
const REQUEST_TIMEOUT_MS = 10_000; // paridad con sendExpoPush del API

/**
 * Suscripción nativa (fila de push_tokens). SubPrefs-compatible a propósito:
 * la MISMA segmentación pura de la web (`wants()`, `morningPendingSubs`)
 * decide sobre ella, y `config`/`presets` viajan con la misma semántica.
 */
export interface NativeSubRow {
  id: string;
  expo_push_token: string;
  device_id: string;
  fav_teams: string[];
  fav_leagues: string[];
  fav_players: string[];
  config: Record<string, unknown>;
  presets: Record<string, string>;
}

export interface ExpoPayload { title: string; body: string; tag: string; url: string; type: string }

/** Convierte la URL web (…/matches/<id>) en ruta de deep link de la app. */
function toUrlPath(url: string): string {
  const m = url.match(/\/matches\/([0-9a-f-]+)/i);
  return m ? `/matches/${m[1]}` : '/';
}

/** Mensaje del API v2: channelId 'live' (lo crea la app antes de pedir
 *  permiso), collapseId = tag del partido (smart bundling: la notificación
 *  viva se REEMPLAZA en la pantalla de bloqueo en vez de apilarse) y TTL de
 *  1 h (paridad con el canal web: un gol entregado horas después no vale nada). */
export function toExpoMessage(sub: { expo_push_token: string }, payload: ExpoPayload) {
  return {
    to: sub.expo_push_token,
    title: payload.title,
    body: payload.body,
    channelId: 'live',
    sound: 'default',
    ttl: 3600,
    collapseId: payload.tag,
    data: { type: payload.type, urlPath: toUrlPath(payload.url) },
  };
}

/** Trocea para respetar el límite de 100 mensajes por POST del API de Expo. */
export function chunkMessages<T>(msgs: T[], size = SEND_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < msgs.length; i += size) out.push(msgs.slice(i, i + size));
  return out;
}

/** Cabeceras comunes. EXPO_ACCESS_TOKEN es OPCIONAL (igual que la prueba del
 *  API): sin token Expo aplica sus límites gratuitos; con él, los del proyecto. */
function expoHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    ...(process.env['EXPO_ACCESS_TOKEN']
      ? { Authorization: `Bearer ${process.env['EXPO_ACCESS_TOKEN']}` }
      : {}),
  };
}

/** Carga las suscripciones nativas (SubPrefs-compatible). */
export async function loadNativeSubs(): Promise<NativeSubRow[]> {
  const res = await db.query<NativeSubRow>(
    `SELECT id, expo_push_token, device_id, fav_teams, fav_leagues, fav_players, config, presets
       FROM push_tokens`,
  );
  return res.rows;
}

/**
 * Envía el payload a las suscripciones nativas por lotes; devuelve sent/failed
 * y consulta los recibos para PODAR los tokens con DeviceNotRegistered (igual
 * que la poda 404/410 del canal web).
 *
 * `master === false` y el silencio nocturno ya los filtra el llamador con la
 * segmentación existente: aquí no se re-decide a quién va el mensaje.
 */
export async function deliverNative(
  subs: NativeSubRow[], payload: ExpoPayload, captureSent: (deviceId: string, type: string) => void,
): Promise<{ sent: number; failed: number }> {
  if (subs.length === 0) return { sent: 0, failed: 0 };
  const messages = subs.map((s) => toExpoMessage(s, payload));
  // receipt id → token: el recibo NO trae el token; sin este mapa no se podría
  // podar la fila correcta en processReceipts.
  const receiptTokens = new Map<string, string>();
  // Poda por ticket: Expo puede marcar DeviceNotRegistered YA en la respuesta
  // del envío (error por-item, sin recibo que consultar) — esos tokens se podan
  // de inmediato, sin esperar a /push/getReceipts.
  const deadTokens: string[] = [];
  let sent = 0, failed = 0;

  for (const [ci, chunk] of chunkMessages(messages).entries()) {
    try {
      const res = await fetch(EXPO_API, {
        method: 'POST',
        headers: expoHeaders(),
        body: JSON.stringify(chunk),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) {
        // El rechazo del LOTE es explícito (rate limit, payload inválido…):
        // log con status para diagnóstico; el próximo ciclo reintenta.
        log.error({ status: res.status }, 'Expo Push API rechazó el lote');
        failed += chunk.length;
        continue;
      }
      const data = (await res.json()) as {
        data: Array<{ id?: string; status?: string; message?: string; details?: { error?: string } }>;
        errors?: Array<Record<string, unknown>>;
      };
      // Errores TOP-LEVEL de la respuesta (rate limit, formato…): antes se
      // tragaban en silencio; van al log para diagnóstico.
      if (data.errors?.length) {
        log.warn({ errors: data.errors }, 'Expo Push API devolvió errores top-level');
      }
      for (const [i, item] of (data.data ?? []).entries()) {
        const sub = subs[ci * SEND_CHUNK + i]; // correspondencia 1:1 por orden
        if (!sub) break; // respuesta desalineada: mejor no inventar destinatarios
        if (item.status === 'ok' && item.id) {
          sent += 1;
          receiptTokens.set(item.id, sub.expo_push_token);
          captureSent(sub.device_id, payload.type);
        } else {
          failed += 1;
          if (item.details?.error === 'DeviceNotRegistered') deadTokens.push(sub.expo_push_token);
          log.warn(
            { deviceId: sub.device_id, detail: item.message ?? item.details?.error ?? item.status },
            'Envío Expo rechazado',
          );
        }
      }
    } catch (err) {
      failed += chunk.length;
      log.error({ err }, 'Fallo de red contra Expo Push');
    }
  }

  // Poda INMEDIATA por ticket: el token marcado en el propio envío ya está
  // muerto. Un fallo de BD aquí no pierde el ciclo: warn y sigue con los
  // recibos (la poda no es urgente, el próximo envío reintenta).
  if (deadTokens.length > 0) {
    try { await pruneDeadTokens(deadTokens); }
    catch (err) { log.warn({ err }, 'Poda por ticket falló — se reintentará con el próximo envío'); }
  }
  if (receiptTokens.size > 0) await processReceipts(receiptTokens);
  return { sent, failed };
}

/** Poda (DELETE) tokens muertos por DeviceNotRegistered: desinstalación o
 *  token rotado. Compartido por la poda por ticket y la por recibo. */
async function pruneDeadTokens(dead: string[]): Promise<void> {
  await db.query(`DELETE FROM push_tokens WHERE expo_push_token = ANY($1::text[])`, [dead]);
  log.info({ pruned: dead.length }, 'Tokens nativos podados (DeviceNotRegistered)');
}

/**
 * Recibos de los envíos aceptados: poda los tokens con DeviceNotRegistered
 * (desinstalación o token rotado). Un fallo de recibos es un warning, no un
 * error: la poda no es urgente y el próximo envío vuelve a consultarlos.
 */
async function processReceipts(receiptTokens: Map<string, string>): Promise<void> {
  for (const chunk of chunkMessages([...receiptTokens.keys()], RECEIPT_CHUNK)) {
    try {
      const res = await fetch(EXPO_RECEIPTS, {
        method: 'POST',
        headers: expoHeaders(),
        body: JSON.stringify({ ids: chunk }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) { log.warn({ status: res.status }, 'Recibos Expo no disponibles'); continue; }
      const data = (await res.json()) as { data: Record<string, { status: string; message?: string; details?: { error?: string } }> };
      const dead: string[] = [];
      for (const id of chunk) {
        const receipt = data.data?.[id]; // recibo ausente = aún pendiente: se ignora
        if (receipt?.status === 'error' && receipt.details?.error === 'DeviceNotRegistered') {
          const token = receiptTokens.get(id);
          if (token) dead.push(token);
        }
      }
      if (dead.length > 0) await pruneDeadTokens(dead);
    } catch (err) {
      log.warn({ err }, 'Fallo procesando recibos Expo — se reintentará con el próximo envío');
    }
  }
}
