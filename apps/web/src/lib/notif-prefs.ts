'use client';

/**
 * Preferencias de notificación POR ENTIDAD (equipos, competiciones, jugadores).
 *
 * Modelo: por defecto un favorito tiene las notificaciones ACTIVADAS. Aquí solo
 * guardamos los que el usuario ha DESACTIVADO (lista de exclusión por tipo), así
 * los favoritos nuevos quedan activados automáticamente.
 *
 * Efecto real: el cliente envía como `fav_teams` solo los equipos activados
 * (ver push.ts), y el emisor del ETL ya segmenta por ahí. Competiciones y
 * jugadores se guardan para cuando el emisor tenga disparadores propios.
 */

export type NotifKind = 'team' | 'league' | 'player';

const KEY = 'rink-notif-disabled';

interface DisabledMap { teams: string[]; leagues: string[]; players: string[] }

function bucket(kind: NotifKind): keyof DisabledMap {
  return kind === 'team' ? 'teams' : kind === 'league' ? 'leagues' : 'players';
}

export function getDisabled(): DisabledMap {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<DisabledMap>;
    return {
      teams:   Array.isArray(raw.teams)   ? raw.teams   : [],
      leagues: Array.isArray(raw.leagues) ? raw.leagues : [],
      players: Array.isArray(raw.players) ? raw.players : [],
    };
  } catch {
    return { teams: [], leagues: [], players: [] };
  }
}

/** Equipos con notificación activada = favoritos menos los desactivados. */
export function enabledTeams(favoriteTeamIds: string[]): string[] {
  const off = new Set(getDisabled().teams);
  return favoriteTeamIds.filter((id) => !off.has(id));
}

/** Competiciones con notificación activada. */
export function enabledLeagues(favoriteLeagueIds: string[]): string[] {
  const off = new Set(getDisabled().leagues);
  return favoriteLeagueIds.filter((id) => !off.has(id));
}

/** Jugadores con notificación activada. */
export function enabledPlayers(favoritePlayerIds: string[]): string[] {
  const off = new Set(getDisabled().players);
  return favoritePlayerIds.filter((id) => !off.has(id));
}

export function isNotifEnabled(kind: NotifKind, id: string): boolean {
  return !getDisabled()[bucket(kind)].includes(id);
}

// ── Presets de notificación por entidad (complete|key_events|results|silent) ────
//
// Modelo nuevo: cada entidad seguida tiene un preset. El selector (modal) lo
// escribe aquí; el emisor segmenta por preset. Mientras no haya modal, "seguido
// sin preset" se trata como 'complete' en el emisor, así que esta clave solo
// guarda elecciones explícitas. Para no romper a quien ya desactivó avisos con
// el modelo viejo (lista de exclusión), getPresets() añade esos como 'silent'.

export type NotificationPreset = 'complete' | 'key_events' | 'results' | 'silent';

const PRESETS_KEY = 'rink-notif-presets';

/**
 * #266 — Decisión PURA del preset efectivo de una entidad. Un preset explícito
 * manda SIEMPRE; si no lo hay, se aplica la compatibilidad con la lista antigua
 * de "desactivados" (desactivado → 'silent', resto → 'complete').
 */
export function resolvePreset(
  explicit: NotificationPreset | undefined,
  legacyDisabled: boolean,
): NotificationPreset {
  if (explicit) return explicit;
  return legacyDisabled ? 'silent' : 'complete';
}

/** #266 — ¿El aviso está encendido para este preset? Solo 'silent' lo apaga. */
export function isPresetEnabled(preset: NotificationPreset): boolean {
  return preset !== 'silent';
}

/** #266 — Preset que aplica el switch al alternarlo (on → complete, off → silent). */
export function presetFromToggle(enabled: boolean): NotificationPreset {
  return enabled ? 'complete' : 'silent';
}

function presetKey(kind: NotifKind, id: string): string {
  return `${kind === 'team' ? 'team' : kind === 'league' ? 'competition' : 'player'}:${id}`;
}

function readPresetMap(): Record<string, NotificationPreset> {
  try {
    const raw = JSON.parse(localStorage.getItem(PRESETS_KEY) ?? '{}') as Record<string, NotificationPreset>;
    return raw && typeof raw === 'object' ? raw : {};
  } catch { return {}; }
}

export function getPreset(kind: NotifKind, id: string): NotificationPreset {
  const explicit = readPresetMap()[presetKey(kind, id)];
  // Back-compat: si estaba desactivado con el modelo viejo, equivale a 'silent';
  // pero un preset explícito manda sobre esa lista.
  return resolvePreset(explicit, !isNotifEnabled(kind, id));
}

export function setPreset(kind: NotifKind, id: string, preset: NotificationPreset): void {
  const map = readPresetMap();
  map[presetKey(kind, id)] = preset;
  try { localStorage.setItem(PRESETS_KEY, JSON.stringify(map)); } catch { /* noop */ }
  // Mantener coherente la lista de exclusión vieja (otros sitios aún la leen).
  setNotifEnabled(kind, id, preset !== 'silent');
}

/**
 * Mapa "<tipo>:<id>" → preset que el cliente sube al backend. Mezcla las
 * elecciones explícitas con la compatibilidad de la lista de exclusión vieja
 * (entidades desactivadas → 'silent'); lo explícito gana.
 */
export function buildPresetPayload(
  favTeams: string[], favLeagues: string[], favPlayers: string[],
): Record<string, NotificationPreset> {
  const out: Record<string, NotificationPreset> = {};
  const dis = getDisabled();
  for (const id of dis.teams)   out[`team:${id}`] = 'silent';
  for (const id of dis.leagues) out[`competition:${id}`] = 'silent';
  for (const id of dis.players) out[`player:${id}`] = 'silent';
  // Las elecciones explícitas del nuevo store mandan sobre lo anterior.
  Object.assign(out, readPresetMap());
  // Solo claves de entidades que realmente se siguen (limpia restos).
  const followed = new Set<string>([
    ...favTeams.map((t) => `team:${t}`),
    ...favLeagues.map((l) => `competition:${l}`),
    ...favPlayers.map((p) => `player:${p}`),
  ]);
  for (const k of Object.keys(out)) if (!followed.has(k)) delete out[k];
  return out;
}

/** Activa/desactiva la notificación de una entidad. Devuelve el nuevo estado. */
export function setNotifEnabled(kind: NotifKind, id: string, enabled: boolean): boolean {
  const map = getDisabled();
  const list = map[bucket(kind)];
  const has = list.includes(id);
  if (enabled && has) map[bucket(kind)] = list.filter((x) => x !== id);
  else if (!enabled && !has) map[bucket(kind)] = [...list, id];
  try { localStorage.setItem(KEY, JSON.stringify(map)); } catch { /* noop */ }
  return enabled;
}
