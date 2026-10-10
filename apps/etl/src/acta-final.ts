/**
 * Final de partido por ACTA (señal explícita de la fuente).
 *
 * El acta (`*_gr_{idp}_1.php`) marca el partido terminado con
 * `#game_period.periodo_fin` ("FINALIZADO"), frente a `periodo_activo` en juego.
 * Es más fiable y más rápida que esperar a que el partido desaparezca del feed
 * (#374, N ciclos) o al vigilante de 5 h, que siguen como respaldo.
 *
 * Guarda: si el feed en vivo de ESTE ciclo todavía lo lista en juego, no se
 * finaliza (las dos fuentes tienen que estar de acuerdo o el feed callar). Así
 * una cabecera intermedia rara no cierra un partido que sigue (p. ej. prórroga).
 */
import { db } from '@sports/db';

export interface EndedByActa {
  matchId: string;
  seasonId: string;
  sourceRef: string;
}

/** Puro: qué partidos con acta cerrada se pueden finalizar ya. */
export function actaFinalCandidates(
  ended: readonly EndedByActa[],
  playingNow: ReadonlySet<string>,
): EndedByActa[] {
  return ended.filter((e) => !playingNow.has(e.sourceRef));
}

/**
 * live → finished para los candidatos (solo si siguen `live`: transición
 * explícita, idempotente). Conserva el marcador; sella inicio/fin si faltaban.
 * Devuelve los partidos finalizados.
 */
export async function finalizeByActa(candidates: readonly EndedByActa[]): Promise<EndedByActa[]> {
  if (candidates.length === 0) return [];
  const res = await db.query<{ id: string }>(
    `UPDATE matches
        SET status      = 'finished',
            finished_at = COALESCE(finished_at, NOW()),
            started_at  = COALESCE(started_at, scheduled_at),
            updated_at  = NOW()
      WHERE id = ANY($1::uuid[]) AND status = 'live'
      RETURNING id`,
    [candidates.map((c) => c.matchId)],
  );
  const done = new Set(res.rows.map((r) => r.id));
  return candidates.filter((c) => done.has(c.matchId));
}
