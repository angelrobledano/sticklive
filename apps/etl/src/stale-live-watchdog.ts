/**
 * Red de seguridad contra partidos fantasma "EN JUEGO".
 *
 * Desde la migración al estado explícito, `live` solo lo pone la fuente (feed
 * en vivo de la FEP o match center de World Skate) y el final lo cierran el
 * feed, el acta (`periodo_fin`) o el resultado del calendario. Pero si TODOS
 * los procesos que lo refrescan se paran, un `live` se queda para siempre y la
 * portada miente: esta red lo corrige.
 *
 * Historia: antes el `live` de World Skate se INFERÍA del reloj y solo se
 * deshacía con otro scrape.
 *
 * Pasó el 20/07/2026 durante el Europeo Sub-17: ITA-FRA seguía "EN JUEGO"
 * cuatro horas después del inicio porque el scraper de World Skate iba detrás
 * de `cron-live` en un bucle secuencial y no le llegaba el turno. Eso ya está
 * arreglado en origen (World Skate se scrapea dentro del ciclo de 45 s), pero
 * el arreglo depende de que ESE proceso concreto funcione. Esto no: barre
 * cualquier `live` imposible, venga de la fuente que venga.
 *
 * NO inventa resultado. Devuelve el partido a `scheduled`, que es lo que la
 * propia heurística habría dicho pasadas las 3 h; el primer scrape bueno le
 * pondrá `finished` con su marcador real. Mejor mostrar una hora que un
 * directo falso.
 *
 * El umbral es generoso a propósito (5 h por defecto): un partido de hockey
 * con prórroga y tanda de penaltis, más retrasos, no llega ni de lejos. Sólo
 * salta cuando algo está roto de verdad.
 */
import * as Sentry from '@sentry/node';
import { createLogger } from '@sports/logger';
import { db } from '@sports/db';

const log = createLogger({ service: 'stale-live-watchdog' });

const STALE_LIVE_HOURS = Number(process.env['STALE_LIVE_HOURS'] ?? 5);

export interface StaleLiveMatch {
  id: string;
  scheduledAt: string;
  competition: string;
}

/**
 * Degrada a `scheduled` los partidos que llevan en `live` más de
 * STALE_LIVE_HOURS desde su hora de inicio. Devuelve los que ha tocado.
 */
export async function sweepStaleLive(seasonIds: string[]): Promise<StaleLiveMatch[]> {
  const res = await db.query<{ id: string; scheduled_at: string; competition: string }>(
    `UPDATE matches m
        SET status = 'scheduled', updated_at = NOW()
       FROM seasons s
       JOIN competitions c ON c.id = s.competition_id
      WHERE s.id = m.season_id
        AND m.season_id = ANY($1)
        AND m.status = 'live'
        -- Desde el saque REAL (started_at, sellado al verlo en juego) y, si no
        -- consta, desde la hora prevista: un partido que empezó tarde no es un
        -- fantasma por mucho que su hora prevista quede lejos.
        AND COALESCE(m.started_at, m.scheduled_at) < NOW() - make_interval(hours => $2::int)
      RETURNING m.id, m.scheduled_at::text AS scheduled_at, c.name AS competition`,
    [seasonIds, STALE_LIVE_HOURS]
  );

  const stale = res.rows.map((r) => ({
    id: r.id, scheduledAt: r.scheduled_at, competition: r.competition,
  }));

  if (stale.length > 0) {
    // A Sentry como warning, no como error: el dato ya está corregido. Pero que
    // salte significa que un scraper lleva horas sin actualizar esos partidos,
    // y eso hay que mirarlo — el síntoma es visible, la causa no.
    log.warn({ count: stale.length, matches: stale, thresholdHours: STALE_LIVE_HOURS },
      'Partidos colgados en live degradados a scheduled — revisar el scraper de esa fuente');
    Sentry.captureMessage(
      `${stale.length} partido(s) llevaban >${STALE_LIVE_HOURS}h en live: algún scraper no está actualizando`,
      { level: 'warning', extra: { matches: stale } }
    );
  }

  return stale;
}
