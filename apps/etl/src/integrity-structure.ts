/**
 * Chequeos diarios de calidad del dato de ESTRUCTURA (fases, migración 072) y
 * de DIRECTO, sobre las temporadas en curso y visibles. Los lanza
 * `integrity-check` (checks 8-13); solo leen.
 *
 * Son la otra mitad de la batería de casos reales: aquella prueba el CÓDIGO
 * contra páginas guardadas; estos miden el DATO real de producción.
 *
 *   8. estructura-fallback   fases cuyo tipo no lo dejó claro la fuente.
 *   9. estructura-sin-adoptar temporadas en curso, con fuente activa, que siguen
 *                             con fases heredadas (el calendario horario debería
 *                             haberlas re-estructurado).
 *  10. partidos-sin-fase     partidos de temporadas en curso sin fase.
 *  11. programados-vencidos  `scheduled` con la hora pasada hace > 24 h: la web
 *                             los enseña «Sin resultado» (resultado no recogido).
 *  12. finalizados-sin-marcador `finished` sin marcador.
 *  13. live-atascado         `live` más allá del umbral del vigilante (desde el
 *                             saque real): el watchdog no está corriendo.
 */
import { db } from '@sports/db';

export interface CheckResult {
  name: string;
  violations: number;
  detail?: string;
  threshold: number;
}

const threshold = (suffix: string): number =>
  Number(process.env[`INTEGRITY_THRESHOLD_${suffix}`] ?? 0);

/** Temporadas en curso y visibles (las que ve el usuario). */
const EN_CURSO = `
  SELECT s.id FROM seasons s JOIN competitions c ON c.id = s.competition_id
   WHERE s.is_current AND s.data_quality = 'ok' AND c.data_quality = 'ok'`;

async function contar(sql: string, params: unknown[] = []): Promise<{ n: number; muestra?: string }> {
  const { rows } = await db.query<{ n: string; muestra: string | null }>(sql, params);
  return { n: Number(rows[0]!.n), muestra: rows[0]!.muestra ?? undefined };
}

export async function checkEstructuraFallback(): Promise<CheckResult> {
  const r = await contar(
    `SELECT count(*)::text AS n,
            left(string_agg(c.name || ' ' || s.name || ' · ' || COALESCE(p.name, p.source_ref, '?'), ' | '), 300) AS muestra
       FROM phases p JOIN seasons s ON s.id = p.season_id JOIN competitions c ON c.id = s.competition_id
      WHERE p.resolved_by = 'fallback' AND s.id IN (${EN_CURSO})`);
  return { name: 'estructura-fallback', violations: r.n, detail: r.muestra, threshold: threshold('FALLBACK') };
}

export async function checkEstructuraSinAdoptar(): Promise<CheckResult> {
  const r = await contar(
    `SELECT count(DISTINCT s.id)::text AS n,
            left(string_agg(DISTINCT c.name || ' ' || s.name, ' | '), 300) AS muestra
       FROM phases p JOIN seasons s ON s.id = p.season_id JOIN competitions c ON c.id = s.competition_id
      WHERE p.resolved_by = 'legacy' AND s.id IN (${EN_CURSO})
        AND EXISTS (SELECT 1 FROM competition_sources cs WHERE cs.competition_id = c.id AND cs.is_active)`);
  return { name: 'estructura-sin-adoptar', violations: r.n, detail: r.muestra, threshold: threshold('SIN_ADOPTAR') };
}

export async function checkPartidosSinFase(): Promise<CheckResult> {
  const r = await contar(
    `SELECT count(*)::text AS n, left(string_agg(m.source_ref, ', '), 200) AS muestra
       FROM matches m WHERE m.phase_id IS NULL AND m.season_id IN (${EN_CURSO})`);
  return { name: 'partidos-sin-fase', violations: r.n, detail: r.muestra, threshold: threshold('SIN_FASE') };
}

export async function checkProgramadosVencidos(): Promise<CheckResult> {
  const r = await contar(
    `SELECT count(*)::text AS n,
            left(string_agg(m.source_ref || ' (' || to_char(m.scheduled_at, 'DD/MM HH24:MI') || ')', ', ' ORDER BY m.scheduled_at), 300) AS muestra
       FROM matches m
      WHERE m.status = 'scheduled' AND m.scheduled_at < NOW() - INTERVAL '24 hours'
        AND m.season_id IN (${EN_CURSO})`);
  return { name: 'programados-vencidos', violations: r.n, detail: r.muestra, threshold: threshold('VENCIDOS') };
}

export async function checkFinalizadosSinMarcador(): Promise<CheckResult> {
  const r = await contar(
    `SELECT count(*)::text AS n, left(string_agg(m.source_ref, ', '), 200) AS muestra
       FROM matches m
      WHERE m.status = 'finished' AND (m.home_score IS NULL OR m.away_score IS NULL)
        AND m.season_id IN (${EN_CURSO})`);
  return { name: 'finalizados-sin-marcador', violations: r.n, detail: r.muestra, threshold: threshold('SIN_MARCADOR') };
}

export async function checkLiveAtascado(): Promise<CheckResult> {
  const horas = Number(process.env['STALE_LIVE_HOURS'] ?? 5) + 1;
  const r = await contar(
    `SELECT count(*)::text AS n, left(string_agg(m.source_ref, ', '), 200) AS muestra
       FROM matches m
      WHERE m.status = 'live'
        AND COALESCE(m.started_at, m.scheduled_at) < NOW() - make_interval(hours => $1::int)`,
    [horas]);
  return { name: 'live-atascado', violations: r.n, detail: r.muestra, threshold: threshold('LIVE') };
}

export const STRUCTURE_CHECKS = [
  checkEstructuraFallback, checkEstructuraSinAdoptar, checkPartidosSinFase,
  checkProgramadosVencidos, checkFinalizadosSinMarcador, checkLiveAtascado,
];
