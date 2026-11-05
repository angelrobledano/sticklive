import { matchDisplayState } from '@sports/shared-types';
import { APP_TZ } from '@sports/core/match-time';

export function formatKickoff(iso: string | null): string {
  if (!iso) return '--:--';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '--:--'; // paridad con la web (match-time.ts)
  return new Intl.DateTimeFormat('es-ES', {
    hour: '2-digit', minute: '2-digit', timeZone: APP_TZ, hour12: false,
  }).format(d);
}

const LOCALE_TAGS: Record<string, string> = {
  ca: 'ca-ES',
  es: 'es-ES',
  en: 'en-GB',
  fr: 'fr-FR',
  it: 'it-IT',
  pt: 'pt-PT',
};

export function formatDayLabel(iso: string | null, locale: string = 'es'): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return ''; // paridad con la web (match-time.ts)
  const tag = LOCALE_TAGS[locale] ?? locale;
  return new Intl.DateTimeFormat(tag, {
    weekday: 'long', day: 'numeric', month: 'short', timeZone: APP_TZ,
  }).format(d);
}

export function formatDayShort(iso: string | null, locale: string = 'es'): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const tag = LOCALE_TAGS[locale] ?? locale;
  return new Intl.DateTimeFormat(tag, {
    weekday: 'short', day: 'numeric', month: 'short', timeZone: APP_TZ,
  }).format(d);
}

/**
 * Clave estable de sección por día (YYYY-MM-DD en Europe/Madrid), Task 5.2:
 * la home la usa como key de sección (la etiqueta humanizada va aparte y puede
 * repetirse/localizarse; la clave es ISO y no colisiona con '__live__').
 */

/**
 * ¿El partido está EN DIRECTO? Solo si la fuente lo da en juego (estado
 * explícito). La hora programada ya NO fabrica un directo: antes un `scheduled`
 * con el saque pasado se pintaba "en vivo" 0-0 durante 5 h aunque no hubiera
 * empezado (retrasos, aplazamientos). Misma regla que la API y la web
 * (`matchDisplayState` en @sports/shared-types).
 *
 * `_scheduledAt` se conserva en la firma para no tocar los llamantes; no
 * interviene en la decisión.
 */
export function isEffectivelyLive(status: string, _scheduledAt?: string | null): boolean {
  return status === 'live' || status === 'halftime' || status === 'overtime' || status === 'penalty_shootout';
}

/**
 * Política de ANUNCIOS (no es el estado del partido): no se mete publicidad en
 * un partido en juego NI en uno cuya hora ya llegó y la fuente aún no da en
 * juego (puede estar empezando y el feed ir con retraso). Conserva la ventana
 * de silencio que antes daba el "directo por reloj", sin pintar un directo
 * falso: lo que se MUESTRA sigue siendo `isEffectivelyLive`.
 */
export function isAdQuietTime(status: string, scheduledAt: string | null | undefined, nowMs = Date.now()): boolean {
  if (isEffectivelyLive(status)) return true;
  return matchDisplayState(status, scheduledAt, nowMs) === 'awaiting_start';
}
