/**
 * Ventana de actividad del directo — `checkWindow` de `cron-live`.
 *
 * Extraído a su propio módulo para poder testear la ventana contra Postgres real
 * sin arrancar el orquestador (que conecta a BD y entra en bucle al importarse).
 */
import { db } from '@sports/db';

interface WindowStatus {
  hasLive:     boolean;  // al menos un partido con status='live'
  hasUpcoming: boolean;  // al menos un partido 'scheduled' en la ventana próxima (con margen atrás)
  hasOverdue:  boolean;  // partidos cuya hora ya pasó (últimas 48h) sin estado final
}

/**
 * Margen hacia ATRÁS de la ventana "upcoming" (#185). En el saque, la fuente aún
 * no ha marcado el partido `live`; sin este margen, deja de ser "upcoming" y el
 * bucle de 45 s se cortaba justo al empezar (los primeros datos tardaban ~5 min).
 */
export const UPCOMING_LOOKBACK_MIN = Number(process.env['WINDOW_LOOKBACK_MINUTES'] ?? 15);

/**
 * Consulta rápida: ¿hay actividad en la ventana de tiempo?
 * Opera sobre TODAS las temporadas activas a la vez (ANY($1)).
 */
export async function checkWindow(
  seasonIds: string[],
  windowHours: number,
  lookbackMin: number = UPCOMING_LOOKBACK_MIN,
): Promise<WindowStatus> {
  const [liveRes, upcomingRes, overdueRes] = await Promise.all([
    db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM matches
       WHERE season_id = ANY($1) AND status = 'live'`,
      [seasonIds]
    ),
    db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM matches
       WHERE season_id    = ANY($1)
         AND status       = 'scheduled'
         AND scheduled_at BETWEEN NOW() - make_interval(mins => $3::int)
                              AND NOW() + make_interval(hours => $2::int)`,
      [seasonIds, windowHours, lookbackMin]
    ),
    // Partidos zombi: su hora pasó pero siguen sin estado final.
    db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM matches
       WHERE season_id    = ANY($1)
         AND status       IN ('scheduled', 'live')
         AND scheduled_at BETWEEN NOW() - INTERVAL '48 hours' AND NOW()`,
      [seasonIds]
    ),
  ]);

  return {
    hasLive:     Number(liveRes.rows[0]?.count     ?? 0) > 0,
    hasUpcoming: Number(upcomingRes.rows[0]?.count  ?? 0) > 0,
    hasOverdue:  Number(overdueRes.rows[0]?.count   ?? 0) > 0,
  };
}
