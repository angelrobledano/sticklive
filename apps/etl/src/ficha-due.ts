import type { FichaCandidate } from './ficha-candidates.js';

/** Red de seguridad: acta de un partido en juego sin cambios, cada 5 min (FICHA_SAFETY_S). */
export const FICHA_SAFETY_MS = Number(process.env['FICHA_SAFETY_S'] ?? 300) * 1000;

/** Lo que el feed general cuenta del partido: si cambia, el acta tiene novedades. */
export function fichaSignature(m: Pick<FichaCandidate, 'status' | 'home_score' | 'away_score' | 'live_is_halftime'>): string {
  return `${m.status}|${m.home_score ?? ''}|${m.away_score ?? ''}|${m.live_is_halftime ? 'ht' : ''}`;
}

/**
 * ¿Toca pedir el acta? (31/10/2026, sidgad bloqueó la IP por exceso de
 * peticiones). Antes se pedía la de cada partido en cada ciclo de 45 s.
 * Ahora: la primera vez, cuando el feed general cambia el marcador, el estado
 * o el descanso (goles, final, descanso), y si no, cada FICHA_SAFETY_MS para
 * recoger tarjetas y faltas que no mueven el marcador. Cada acta trae todo lo
 * ocurrido hasta ese momento.
 */
export function fichaDue(
  m: Pick<FichaCandidate, 'status' | 'home_score' | 'away_score' | 'live_is_halftime'>,
  prev: { at: number; sig: string } | undefined,
  now: number,
): boolean {
  if (!prev) return true;
  if (prev.sig !== fichaSignature(m)) return true;
  return now - prev.at >= FICHA_SAFETY_MS;
}

