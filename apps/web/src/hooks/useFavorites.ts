'use client';

import { useState, useEffect, useCallback } from 'react';
import { track, setPersonProps, favoriteToggleEvent, type FavoriteKind } from '@/lib/analytics';
import { syncPushConfig } from '@/lib/push';
import { getSession } from '@/hooks/useAuth';

const STORAGE_KEY = 'rink-favorites';      // equipos
const LEAGUES_KEY = 'rink-fav-leagues';    // ligas / competiciones
const PLAYERS_KEY = 'rink-fav-players';    // jugadores
const FAV_NAMES_KEY = 'rink-fav-names';    // mapa id→nombre de jugadores seguidos
/** Clave antigua de la lista de competiciones (se migra a LEAGUES_KEY). */
const LEGACY_COMPS_KEY = 'sl_fav_comps';

const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3000';

/** Evento interno para mantener en sincronía todas las instancias del hook. */
const FAVS_EVENT = 'rink-favs-changed';

type Kind = FavoriteKind;

/** Opciones de analítica al marcar/desmarcar un favorito (#243). */
export interface FavoriteToggleOptions {
  /** Preset de notificaciones elegido al seguir; viaja como `preset_selected`. */
  preset?: string;
  /** Desde dónde se sigue; viaja como `source`. */
  source?: string;
}

// ── Helpers de localStorage ────────────────────────────────────────────────────

function readArr(key: string): string[] {
  try { return JSON.parse(localStorage.getItem(key) ?? '[]') as string[]; } catch { return []; }
}
function writeArr(key: string, value: string[]) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* noop */ }
}
/** Notifica al resto de componentes (mismo tab) que los favoritos cambiaron. */
function broadcast() {
  try { window.dispatchEvent(new Event(FAVS_EVENT)); } catch { /* noop */ }
}

// ── Sincronización con la cuenta (solo si hay sesión) ──────────────────────────
//
// El estado canónico sigue siendo localStorage (funciona anónimo y offline). Si
// además hay sesión, cada cambio se refleja en la nube en el momento (no solo en
// el login), de modo que los favoritos viajan entre dispositivos de verdad.

function arrKeyFor(kind: Kind): 'teams' | 'leagues' | 'players' {
  return kind === 'team' ? 'teams' : kind === 'league' ? 'leagues' : 'players';
}

function cloudAdd(kind: Kind, id: string) {
  const session = getSession();
  if (!session) return;
  void fetch(`${API_URL}/auth/favorites/merge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session}` },
    body: JSON.stringify({ [arrKeyFor(kind)]: [id] }),
  }).catch(() => { /* se reintenta en la próxima reconciliación */ });
}

function cloudRemove(kind: Kind, id: string) {
  const session = getSession();
  if (!session) return;
  void fetch(`${API_URL}/auth/favorites`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session}` },
    body: JSON.stringify({ kind, refId: id }),
  }).catch(() => { /* idem */ });
}

// ── Tombstones: bajas locales que NO deben reaparecer en la reconciliación ──────
// Quitar un favorito SIN conexión (el DELETE en la nube falla) lo recuperaría al
// volver online. Guardamos las bajas y, en la reconciliación, las restamos del
// estado resultante + reintentamos el DELETE en la nube.
const TOMBSTONE_KEY = 'rink-fav-removed';
interface Tombstones { teams: string[]; leagues: string[]; players: string[] }

function readTombstones(): Tombstones {
  try {
    const raw = JSON.parse(localStorage.getItem(TOMBSTONE_KEY) ?? '{}') as Partial<Tombstones>;
    return { teams: raw.teams ?? [], leagues: raw.leagues ?? [], players: raw.players ?? [] };
  } catch { return { teams: [], leagues: [], players: [] }; }
}
function writeTombstones(t: Tombstones) {
  try { localStorage.setItem(TOMBSTONE_KEY, JSON.stringify(t)); } catch { /* noop */ }
}
function tombstoneBucket(kind: Kind): keyof Tombstones {
  return kind === 'team' ? 'teams' : kind === 'league' ? 'leagues' : 'players';
}
function addTombstone(kind: Kind, id: string) {
  const t = readTombstones(); const k = tombstoneBucket(kind);
  if (!t[k].includes(id)) { t[k] = [...t[k], id]; writeTombstones(t); }
}
function clearTombstone(kind: Kind, id: string) {
  const t = readTombstones(); const k = tombstoneBucket(kind);
  if (t[k].includes(id)) { t[k] = t[k].filter((x) => x !== id); writeTombstones(t); }
}

// ── Reconciliación pura local↔nube (#268) ──────────────────────────────────────
//
// En el PRIMER login subimos los favoritos locales y hacemos unión con la nube
// (onboarding). En las sincronizaciones posteriores la NUBE es la fuente de
// verdad: NO reinsertamos lo que solo está en local (podría ser un favorito que
// otro dispositivo dejó de seguir), solo aplicamos los tombstones locales y
// reintentamos su borrado. Antes la unión era siempre aditiva y el favorito
// borrado "resucitaba" desde cualquier dispositivo que aún lo tuviera en local.

export interface FavoritesSnapshot { teams: string[]; leagues: string[]; players: string[] }

export interface FavoriteReconciliation {
  /** Estado local resultante (lo que se escribe en localStorage). */
  next: FavoritesSnapshot;
  /** Tombstones que siguen en la nube y hay que reintentar borrar. */
  removals: FavoritesSnapshot;
}

function dedupe(ids: string[]): string[] {
  return Array.from(new Set(ids));
}

/** Unión de local+nube sin los tombstones, deduplicada (local primero). */
function unionMinus(a: string[], b: string[], removed: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of [...a, ...b]) {
    if (removed.includes(id) || seen.has(id)) continue;
    seen.add(id); out.push(id);
  }
  return out;
}

/**
 * Decide el estado local tras reconciliar. Pura para poder fijar con tests el
 * caso multi-dispositivo (#268) sin tocar localStorage ni la red.
 */
export function reconcileFavorites(
  local: FavoritesSnapshot,
  cloud: FavoritesSnapshot,
  tombstones: FavoritesSnapshot,
  opts: { firstLogin: boolean },
): FavoriteReconciliation {
  const keys = ['teams', 'leagues', 'players'] as const;
  const next: FavoritesSnapshot = { teams: [], leagues: [], players: [] };
  const removals: FavoritesSnapshot = { teams: [], leagues: [], players: [] };
  for (const k of keys) {
    const removed = tombstones[k];
    next[k] = opts.firstLogin
      ? unionMinus(local[k], cloud[k], removed)
      : dedupe(cloud[k]).filter((id) => !removed.includes(id));
    const inCloud = new Set(cloud[k]);
    removals[k] = dedupe(removed).filter((id) => inCloud.has(id));
  }
  return { next, removals };
}

/**
 * Marca de "esta CUENTA ya se sincronizó al menos una vez en este dispositivo":
 * a partir de ahí la nube manda en la reconciliación (#268). Se indexa por
 * email (legible en `useAuth`) para que un cambio de usuario en el mismo
 * dispositivo siga haciendo su propia fusión de primer login y no se mezclen
 * favoritos entre cuentas.
 */
const SYNCED_KEY = 'rink-fav-synced';
function syncedKey(): string {
  try {
    const email = localStorage.getItem('rink-session-email');
    return email ? `${SYNCED_KEY}:${email.toLowerCase()}` : SYNCED_KEY;
  } catch { return SYNCED_KEY; }
}
function hasSyncedBefore(): boolean {
  try { return localStorage.getItem(syncedKey()) === '1'; } catch { return false; }
}
function markSynced(): void {
  try { localStorage.setItem(syncedKey(), '1'); } catch { /* noop */ }
}

/**
 * Reconcilia local↔nube una sola vez por carga de app. Primera vez: sube lo
 * local y une con la cuenta (onboarding). Posteriores: la nube manda y solo se
 * reintentan los borrados locales. El guard de módulo evita N llamadas cuando
 * el hook se usa en muchos componentes.
 */
let cloudReconciled = false;
function reconcileCloud() {
  if (cloudReconciled) return;
  const session = getSession();
  if (!session) return;
  cloudReconciled = true;

  const firstLogin = !hasSyncedBefore();
  const local: FavoritesSnapshot = {
    teams:   readArr(STORAGE_KEY),
    leagues: readArr(LEAGUES_KEY),
    players: readArr(PLAYERS_KEY),
  };
  const tombstones = readTombstones();
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${session}` };

  // Primer login → POST: el servidor hace la unión y devuelve el estado total.
  // Posteriores → GET: solo leemos la nube (fuente de verdad multi-dispositivo).
  const request = firstLogin
    ? fetch(`${API_URL}/auth/favorites/merge`, {
        method: 'POST', headers, body: JSON.stringify(local),
      })
    : fetch(`${API_URL}/auth/favorites`, { method: 'GET', headers });

  request
    .then((r) => (r.ok ? r.json() : null))
    .then((cloud: Partial<FavoritesSnapshot> | null) => {
      if (!cloud) { cloudReconciled = false; return; } // permite reintento
      const result = reconcileFavorites(
        local,
        {
          teams:   cloud.teams   ?? [],
          leagues: cloud.leagues ?? [],
          players: cloud.players ?? [],
        },
        tombstones,
        { firstLogin },
      );
      // Reintenta borrar en la nube lo que sigue marcado como baja local.
      for (const id of result.removals.teams)   cloudRemove('team', id);
      for (const id of result.removals.leagues) cloudRemove('league', id);
      for (const id of result.removals.players) cloudRemove('player', id);
      // Escribe el estado reconciliado (nube − bajas, o unión − bajas).
      writeArr(STORAGE_KEY, result.next.teams);
      writeArr(LEAGUES_KEY, result.next.leagues);
      writeArr(PLAYERS_KEY, result.next.players);
      if (firstLogin) markSynced();
      broadcast();
    })
    .catch(() => { cloudReconciled = false; });
}

// ── Hook ────────────────────────────────────────────────────────────────────────

export function useFavorites() {
  const [favorites, setFavorites] = useState<string[]>([]);
  const [leagues, setLeagues]     = useState<string[]>([]);
  const [players, setPlayers]     = useState<string[]>([]);
  // Evita parpadeo de hidratación: el estado real se monta en cliente.
  const [mounted, setMounted]     = useState(false);

  useEffect(() => {
    setMounted(true);

    // Migración: la lista de competiciones usaba su propia clave ('sl_fav_comps').
    // La unificamos en LEAGUES_KEY para que estrella, "Mis ligas", Ajustes y
    // "Gestionar favoritos" compartan el mismo estado.
    const legacy = readArr(LEGACY_COMPS_KEY);
    if (legacy.length > 0) {
      writeArr(LEAGUES_KEY, Array.from(new Set([...readArr(LEAGUES_KEY), ...legacy])));
      try { localStorage.removeItem(LEGACY_COMPS_KEY); } catch { /* noop */ }
    }

    // Relee las tres listas de localStorage hacia el estado de React.
    const refresh = () => {
      setFavorites(readArr(STORAGE_KEY));
      setLeagues(readArr(LEAGUES_KEY));
      setPlayers(readArr(PLAYERS_KEY));
    };
    refresh();

    // Mantiene en sincronía todas las instancias del hook (mismo tab) y entre
    // pestañas (evento nativo 'storage').
    window.addEventListener(FAVS_EVENT, refresh);
    window.addEventListener('storage', refresh);

    // Si hay sesión, sincroniza con la cuenta y emite FAVS_EVENT al terminar.
    reconcileCloud();

    return () => {
      window.removeEventListener(FAVS_EVENT, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  // ── Equipos ─────────────────────────────────────────────────────────────────
  const toggle = useCallback((teamId: string, opts?: FavoriteToggleOptions) => {
    const cur = readArr(STORAGE_KEY);
    const adding = !cur.includes(teamId);
    const next = adding ? [...cur, teamId] : cur.filter((id) => id !== teamId);
    writeArr(STORAGE_KEY, next);
    broadcast();
    const ev = favoriteToggleEvent(adding, 'team', teamId, next.length, opts?.preset, opts?.source);
    track(ev.event, { ...ev.props });
    setPersonProps({ favorite_teams: next.length });
    void syncPushConfig(); // el emisor de push segmenta por equipos favoritos
    if (adding) { clearTombstone('team', teamId); cloudAdd('team', teamId); }
    else { addTombstone('team', teamId); cloudRemove('team', teamId); }
  }, []);

  const isFavorite = useCallback(
    (teamId: string) => favorites.includes(teamId),
    [favorites]
  );

  // ── Ligas ─────────────────────────────────────────────────────────────────────
  const toggleLeague = useCallback((competitionId: string, opts?: FavoriteToggleOptions) => {
    const cur = readArr(LEAGUES_KEY);
    const adding = !cur.includes(competitionId);
    const next = adding ? [...cur, competitionId] : cur.filter((id) => id !== competitionId);
    writeArr(LEAGUES_KEY, next);
    broadcast();
    const ev = favoriteToggleEvent(adding, 'league', competitionId, next.length, opts?.preset, opts?.source);
    track(ev.event, { ...ev.props });
    setPersonProps({ favorite_leagues: next.length });
    void syncPushConfig(); // el emisor segmenta por ligas favoritas
    if (adding) { clearTombstone('league', competitionId); cloudAdd('league', competitionId); }
    else { addTombstone('league', competitionId); cloudRemove('league', competitionId); }
  }, []);

  const isLeagueFavorite = useCallback(
    (competitionId: string) => leagues.includes(competitionId),
    [leagues]
  );

  // ── Jugadores (+ mapa de nombres para listados) ────────────────────────────────
  const togglePlayer = useCallback((playerId: string, name?: string, opts?: FavoriteToggleOptions) => {
    const cur = readArr(PLAYERS_KEY);
    const adding = !cur.includes(playerId);
    const next = adding ? [...cur, playerId] : cur.filter((id) => id !== playerId);
    writeArr(PLAYERS_KEY, next);
    try {
      const names = JSON.parse(localStorage.getItem(FAV_NAMES_KEY) ?? '{}') as Record<string, string>;
      if (adding && name) names[playerId] = name;
      if (!adding) delete names[playerId];
      localStorage.setItem(FAV_NAMES_KEY, JSON.stringify(names));
    } catch { /* noop */ }
    broadcast();
    const ev = favoriteToggleEvent(adding, 'player', playerId, next.length, opts?.preset, opts?.source);
    track(ev.event, { ...ev.props });
    setPersonProps({ favorite_players: next.length });
    void syncPushConfig(); // el emisor segmenta por jugadores favoritos
    if (adding) { clearTombstone('player', playerId); cloudAdd('player', playerId); }
    else { addTombstone('player', playerId); cloudRemove('player', playerId); }
  }, []);

  const isPlayerFavorite = useCallback(
    (playerId: string) => players.includes(playerId),
    [players]
  );

  return {
    favorites, toggle, isFavorite,
    leagues, toggleLeague, isLeagueFavorite,
    players, togglePlayer, isPlayerFavorite,
    mounted,
  };
}

/** Nombres de jugadores favoritos guardados al seguirlos (para listados) */
export function getFavNames(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(FAV_NAMES_KEY) ?? '{}'); } catch { return {}; }
}
