'use client';

/**
 * Cliente de Web Push: registro del Service Worker, suscripción con la
 * clave VAPID pública y sincronización de preferencias/favoritos con la API
 * (el emisor segmenta con lo que haya en push_subscriptions).
 */

const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3000';
const VAPID_PUBLIC = process.env['NEXT_PUBLIC_VAPID_PUBLIC_KEY'] ?? '';

export function pushSupported(): boolean {
  return typeof window !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && Boolean(VAPID_PUBLIC);
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(b64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

function gather() {
  let favTeams: string[] = [];
  let config: Record<string, unknown> = {};
  let deviceId = 'unknown';
  let locale = 'es';
  try {
    favTeams = JSON.parse(localStorage.getItem('rink-favorites') ?? '[]');
    config   = JSON.parse(localStorage.getItem('rink-notif-config') ?? '{}');
    deviceId = localStorage.getItem('rink-device-id') ?? 'unknown';
    locale   = localStorage.getItem('sticklive_locale') ?? 'es';
  } catch { /* noop */ }
  return { favTeams, config, deviceId, locale };
}

/**
 * Pide permiso, suscribe el navegador y sube la suscripción a la API.
 * Devuelve true si quedó suscrito.
 */
export async function enablePush(): Promise<boolean> {
  if (!pushSupported()) return false;
  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return false;

    const reg = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;

    const subscription =
      (await reg.pushManager.getSubscription()) ??
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC) as BufferSource,
      }));

    const res = await fetch(`${API_URL}/push/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription, ...gather() }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Re-sincroniza preferencias/favoritos si ya hay suscripción activa. */
export async function syncPushConfig(): Promise<void> {
  if (!pushSupported()) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration('/sw.js');
    const subscription = await reg?.pushManager.getSubscription();
    if (!subscription) return;
    await fetch(`${API_URL}/push/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription, ...gather() }),
    });
  } catch { /* noop */ }
}

/** Cancela la suscripción local y la borra del servidor. */
export async function disablePush(): Promise<void> {
  try {
    const reg = await navigator.serviceWorker.getRegistration('/sw.js');
    const subscription = await reg?.pushManager.getSubscription();
    if (!subscription) return;
    await fetch(`${API_URL}/push/subscribe`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: subscription.endpoint }),
    });
    await subscription.unsubscribe();
  } catch { /* noop */ }
}
