/**
 * Emisor de Web Push — se engancha al ciclo del cron-live.
 *
 * Estrategia: snapshot de partidos antes del ciclo → diff después.
 * Detecta inicio de partido, goles (de cada lado) y final, y notifica a las
 * suscripciones segmentando por las preferencias y favoritos que el cliente
 * sincroniza en push_subscriptions.
 *
 * Política (notification-copy.ts):
 *   · Smart bundling: tag por partido → una notificación viva que se actualiza.
 *   · Silencio nocturno: con quietNight activo, nada entre 23:00–08:00.
 */
import webpush from 'web-push';
import { db } from '@sports/db';
import { createLogger } from '@sports/logger';
import {
  branded, matchTag, goalAlert, finalAlert, liveBody, isQuietHours,
  type MatchRef,
} from '../../api/src/lib/notification-copy.js';

const log = createLogger({ service: 'push-dispatcher' });

const VAPID_PUBLIC  = process.env['VAPID_PUBLIC_KEY']  ?? '';
const VAPID_PRIVATE = process.env['VAPID_PRIVATE_KEY'] ?? '';
const VAPID_SUBJECT = process.env['VAPID_SUBJECT'] ?? 'mailto:robledano@gmail.com';
const WEB_BASE = process.env['WEB_BASE_URL'] ?? 'https://sticklive.eu';

export const pushEnabled = Boolean(VAPID_PUBLIC && VAPID_PRIVATE);
if (pushEnabled) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
}

// ── Snapshot/diff ─────────────────────────────────────────────────────────────

export interface MatchSnap {
  id: string;
  status: string;
  home_score: number | null;
  away_score: number | null;
  home_team_id: string | null;
  away_team_id: string | null;
  home_name: string | null;
  away_name: string | null;
}

export async function snapshotMatches(seasonId: string): Promise<Map<string, MatchSnap>> {
  const res = await db.query<MatchSnap>(`
    SELECT m.id, m.status, m.home_score, m.away_score,
           m.home_team_id, m.away_team_id,
           ht.short_name AS home_name, at.short_name AS away_name
    FROM matches m
    LEFT JOIN teams ht ON ht.id = m.home_team_id
    LEFT JOIN teams at ON at.id = m.away_team_id
    WHERE m.season_id = $1
      AND (m.status IN ('live')
           OR m.scheduled_at BETWEEN NOW() - INTERVAL '4 hours' AND NOW() + INTERVAL '4 hours')
  `, [seasonId]);
  return new Map(res.rows.map((r) => [r.id, r]));
}

interface PushPayload {
  title: string;
  body: string;
  tag: string;
  url: string;
}

interface SubRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  fav_teams: string[];
  config: Record<string, boolean>;
}

/** Compara el snapshot previo con el estado actual y emite notificaciones. */
export async function diffAndNotify(prev: Map<string, MatchSnap>, seasonId: string): Promise<void> {
  if (!pushEnabled || prev.size === 0) return;

  const current = await snapshotMatches(seasonId);
  const toSend: Array<{ payload: PushPayload; matchTeams: string[]; kind: 'start' | 'goal' | 'final' }> = [];

  for (const [id, now] of current) {
    const before = prev.get(id);
    if (!before) continue;

    const ref: MatchRef = {
      homeShort: now.home_name ?? 'Local',
      awayShort: now.away_name ?? 'Visitante',
      homeScore: now.home_score ?? 0,
      awayScore: now.away_score ?? 0,
    };
    const teams = [now.home_team_id, now.away_team_id].filter(Boolean) as string[];
    const url = `${WEB_BASE}/matches/${id}`;
    const tag = matchTag(id);

    // Inicio de partido
    if (before.status === 'scheduled' && now.status === 'live') {
      toSend.push({
        kind: 'start',
        matchTeams: teams,
        payload: { title: branded(`${ref.homeShort} – ${ref.awayShort} ¡en juego!`), body: liveBody(ref), tag, url },
      });
    }

    // Goles (cualquiera de los dos marcadores sube)
    const homeDiff = (now.home_score ?? 0) - (before.home_score ?? 0);
    const awayDiff = (now.away_score ?? 0) - (before.away_score ?? 0);
    if (now.status === 'live' && (homeDiff > 0 || awayDiff > 0)) {
      const scorer = homeDiff > 0 ? ref.homeShort : ref.awayShort;
      toSend.push({
        kind: 'goal',
        matchTeams: teams,
        payload: { title: branded(goalAlert(scorer, null, ref)), body: liveBody(ref), tag, url },
      });
    }

    // Final
    if (before.status !== 'finished' && now.status === 'finished') {
      toSend.push({
        kind: 'final',
        matchTeams: teams,
        payload: { title: branded(finalAlert(ref)), body: '', tag, url },
      });
    }
  }

  if (toSend.length === 0) return;

  const subs = await db.query<SubRow>(
    `SELECT id, endpoint, p256dh, auth, fav_teams, config FROM push_subscriptions`
  );
  if (subs.rows.length === 0) return;

  const night = isQuietHours();
  let sent = 0, pruned = 0;

  for (const sub of subs.rows) {
    const cfg = sub.config ?? {};
    if (cfg['master'] === false) continue;
    if (night && cfg['quietNight'] !== false) continue; // por defecto, respetar la noche

    for (const ev of toSend) {
      const isFav = ev.matchTeams.some((t) => (sub.fav_teams ?? []).includes(t));
      // Segmentación: favoritos > global
      const wants =
        ev.kind === 'goal'  ? (isFav ? cfg['favGoals'] !== false : false) :
        ev.kind === 'start' ? (isFav ? cfg['favMatchStart'] !== false : cfg['globalMatchStart'] === true) :
        /* final */           (isFav ? cfg['favMatchEnd'] !== false   : cfg['globalMatchEnd'] === true);
      if (!wants) continue;

      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(ev.payload),
          { TTL: 3600 }
        );
        sent++;
      } catch (err: unknown) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          // Suscripción muerta (navegador desinstalado/permiso revocado)
          await db.query(`DELETE FROM push_subscriptions WHERE id = $1`, [sub.id]);
          pruned++;
          break;
        }
        log.warn({ status }, 'Fallo al enviar push — continuando');
      }
    }
  }

  log.info({ events: toSend.length, sent, pruned }, '📲 Push despachadas');
}
