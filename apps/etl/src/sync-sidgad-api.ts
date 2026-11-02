/**
 * Pabellones y fichas de jugador desde la API de sidgad (2/11/2026).
 *
 * Acceso dado por la RFEP. Uso acotado (ver apps/scraper/src/sidgad-api/
 * client.ts): solo `pistas` y `profile`, una petición cada 2 s, y la tanda se
 * para ante cualquier 401/403/429 o token inválido.
 *
 *   --venues            catálogo de pabellones (1 petición)
 *   --players[=N]       fichas de jugador RFEP, N por pasada (por defecto 600:
 *                       ~20-40 min). Primero los nunca consultados, luego los
 *                       consultados hace más de 30 días.
 *   --dry-run           sin escribir
 *
 * De la ficha se guarda: foto (la URL exacta de la fuente), nacionalidad y
 * fecha de nacimiento. La fecha NO se publica (decisión de producto: hay
 * menores en base). Solo se escribe si el apellido de la ficha coincide con
 * el nuestro, para no cruzar personas por un id equivocado.
 *
 * Producción: PAUSADO hasta el visto bueno de la RFEP. Fuera del scheduler y
 * además exige SIDGAD_API_ENABLED=1.
 *   $DC exec etl node dist/apps/etl/src/sync-sidgad-api.js --venues --players=600
 */
import './instrument.js';
import * as Sentry from '@sentry/node';
import { pathToFileURL } from 'node:url';
import { db, closeDb, upsertVenues } from '@sports/db';
import { createLogger } from '@sports/logger';
import {
  SidgadApi, SidgadApiBlocked, SidgadApiNotFound, sidgadApiConfig,
  parsePistas, parseProfile, sameSurname,
} from '../../scraper/src/sidgad-api/client.js';

const log = createLogger({ service: 'sync-sidgad-api' });

/** Temporadas sidgad en las que buscar la ficha (la actual primero). */
const SEASONS = (process.env['SIDGAD_API_SEASONS'] ?? '41,39').split(',').map((s) => s.trim()).filter(Boolean);

export async function syncVenues(api: SidgadApi, dryRun: boolean): Promise<number> {
  const venues = parsePistas(await api.get('pistas'));
  if (venues.length === 0) throw new Error('La API de sidgad devolvió 0 pabellones');
  if (dryRun) return venues.length;
  return upsertVenues(venues.map((v) => ({
    sourceRef: `sidgad_rfep_pista_${v.id}`,
    name: v.name, street: v.street, postalCode: v.postalCode, capacity: v.capacity, surface: v.surface,
  })));
}

interface PlayerRow { id: string; source_ref: string; first_name: string; last_name: string; photo_url: string | null }

export async function syncPlayers(api: SidgadApi, limit: number, dryRun: boolean): Promise<{ checked: number; updated: number; skipped: number }> {
  const { rows } = await db.query<PlayerRow>(
    `SELECT id, source_ref, first_name, last_name, photo_url
       FROM players
      WHERE source_ref ~ '^fep_player_[0-9]+$'
        AND (profile_checked_at IS NULL OR profile_checked_at < NOW() - INTERVAL '30 days')
      ORDER BY profile_checked_at NULLS FIRST, id
      LIMIT $1`,
    [limit],
  );
  let updated = 0;
  let skipped = 0;
  let checked = 0;
  for (const p of rows) {
    const sidgadId = p.source_ref.replace('fep_player_', '');
    let profile = null;
    for (const s of SEASONS) {
      try {
        profile = parseProfile(await api.get('profile', { id: sidgadId, s }));
        if (profile) break;
      } catch (err) {
        if (err instanceof SidgadApiNotFound) continue;
        throw err;
      }
    }
    checked++;
    if (dryRun) continue;
    if (profile && sameSurname(p.last_name || p.first_name, profile.lastName)) {
      await db.query(
        `UPDATE players SET
           nationality = COALESCE($2, nationality),
           birth_date  = COALESCE($3::date, birth_date),
           photo_url   = COALESCE($4, photo_url),
           profile_checked_at = NOW(), updated_at = NOW()
         WHERE id = $1`,
        [p.id, profile.nationality, profile.birthDate, profile.photoUrl],
      );
      updated++;
    } else {
      if (profile) {
        log.warn({ player: p.id, ours: p.last_name, theirs: profile.lastName }, 'Ficha con otro apellido — no se escribe');
      }
      await db.query(`UPDATE players SET profile_checked_at = NOW() WHERE id = $1`, [p.id]);
      skipped++;
    }
  }
  return { checked, updated, skipped };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const playersArg = args.find((a) => a.startsWith('--players'));
  const limit = playersArg?.includes('=') ? Number(playersArg.split('=')[1]) : 600;
  // Pausado (2/11/2026) hasta que la RFEP dé el visto bueno explícito al uso
  // de la API: sin SIDGAD_API_ENABLED=1 no sale ninguna petición.
  if (process.env['SIDGAD_API_ENABLED'] !== '1') {
    log.info('API de sidgad desactivada (SIDGAD_API_ENABLED != 1) — no se hace ninguna petición');
    return;
  }
  const cfg = sidgadApiConfig();
  if (!cfg) {
    log.info('SIDGAD_API_TOKEN no definido — se omite la sincronización con la API de sidgad');
    return;
  }
  const api = new SidgadApi(cfg);
  try {
    if (args.includes('--venues')) {
      const n = await syncVenues(api, dryRun);
      log.info({ venues: n, dryRun }, 'Pabellones sincronizados');
    }
    if (playersArg) {
      const r = await syncPlayers(api, limit, dryRun);
      log.info({ ...r, dryRun }, 'Fichas de jugador sincronizadas');
    }
  } catch (err) {
    if (err instanceof SidgadApiBlocked) {
      log.error({ err: err.message }, 'La API de sidgad rechaza el acceso — se para la tanda');
      Sentry.captureMessage(`API de sidgad: acceso rechazado (${err.message})`, { level: 'warning', fingerprint: ['sidgad-api-blocked'] });
      return;
    }
    throw err;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main()
    .catch((err) => { log.error({ err }, 'sync-sidgad-api falló'); Sentry.captureException(err); process.exitCode = 1; })
    .finally(async () => { await Sentry.flush(2000).catch(() => {}); await closeDb(); });
}
