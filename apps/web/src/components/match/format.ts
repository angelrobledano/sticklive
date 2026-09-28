/**
 * Helpers de formato (fecha/hora/nombres) y crono de eventos de la ficha de
 * partido. Funciones puras, sin React.
 */
import { APP_TZ } from '@/lib/match-time';

/**
 * Hora del partido. `tz` es la zona de la competición (columna 042); si viene
 * null/undefined cae a Europe/Madrid, que es como la fuente publica el
 * calendario hoy → cero cambio para las ligas actuales. La AGRUPACIÓN por día
 * sigue anclada en Madrid (ver match-time.ts): esto solo afecta a la hora que
 * se pinta de un partido concreto.
 */
export function formatTime(iso: string | null, tz?: string | null, locale = 'es'): string {
  if (!iso) return '--:--';
  return new Date(iso).toLocaleTimeString(locale, {
    hour: '2-digit', minute: '2-digit', timeZone: tz || APP_TZ,
  });
}

export function formatDate(iso: string | null, tz?: string | null, locale = 'es'): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString(locale, {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
    timeZone: tz || APP_TZ,
  });
}

export function toTitleCase(s: string): string {
  return s
    .toLowerCase()
    .split(/\s+/)
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(' ');
}

/**
 * "Nombre Apellido" legible a partir de first/last de la API.
 * Solo el primer apellido: las mayúsculas sostenidas y los dos apellidos
 * de la fuente fatigan y rompen el ancho en móvil.
 */
export function playerFullName(p: { firstName: string; lastName: string } | null): string {
  if (!p) return '';
  const surname = p.lastName.trim().split(/\s+/)[0] ?? '';
  return toTitleCase(`${p.firstName} ${surname}`.trim());
}

/**
 * Igual que playerFullName pero desde el nombre crudo de la alineación
 * ("ALABART GONZALEZ IGNACIO" → "Ignacio Alabart").
 */
export function displayLineupName(raw: string): string {
  const parts = raw.trim().split(/\s+/);
  if (parts.length === 1) return toTitleCase(parts[0]!);
  const first = parts[parts.length - 1]!;
  const surname = parts[0]!;
  return toTitleCase(`${first} ${surname}`);
}

/** Apellido corto del jugador de un evento ("ALABART GONZALEZ" → "Alabart") */
export function eventSurname(p: { firstName: string; lastName: string }): string {
  const last = (p.lastName || p.firstName).trim().split(/\s+/)[0] ?? '';
  return toTitleCase(last);
}

/**
 * Crono del evento en clave de hockey: TIEMPO RESTANTE en formato MM:SS,
 * tal y como lo mostraba el marcador (cuenta atrás desde 25:00 por parte).
 * Si el acta no trae el instante exacto (eventos antiguos sin reprocesar),
 * se aproxima desde el minuto transcurrido: restante ≈ 25 - minuto.
 */
export function fmtEventClock(ev: { clock?: string | null; minute: number | null }): string {
  if (ev.clock) return ev.clock;
  if (ev.minute == null) return '–:–';
  const remaining = Math.max(0, 25 - ev.minute);
  return `${String(remaining).padStart(2, '0')}:00`;
}
