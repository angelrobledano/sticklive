// Sentry PRIMERO: instrument interceptando la carga de módulos (ver instrument.ts).
import './instrument.js';
import * as Sentry from '@sentry/node';
import { pathToFileURL } from 'node:url';
import { createLogger } from '@sports/logger';
import { db, closeDb } from '@sports/db';
import type { QueryResultRow } from 'pg';

/**
 * Informe de integridad histórica VERSIONADO (#237).
 *
 * Es la re-auditoría de la batería del 27/09 convertida en script: las mismas
 * familias de checks que lanzaron los 5 agentes, pero ejecutables en cualquier
 * momento contra la base real y con números comparables entre ejecuciones.
 * Complementa al chequeo DIARIO (#231): ese vigila invariantes críticas cada
 * día; este es el informe completo de estado histórico (más queries, más
 * detalle) para decidir campañas.
 *
 * SOLO LECTURA: ningún check escribe. Salida por stdout en texto plano.
 *
 * Uso:  node dist/apps/etl/src/audit-integrity-report.js
 */

const log = createLogger({ service: 'audit-integrity-report' });

async function q<T extends QueryResultRow>(name: string, sql: string): Promise<T[]> {
  const { rows } = await db.query<T>(sql);
  return rows;
}

async function main(): Promise<void> {
  console.log('════════ INFORME DE INTEGRIDAD HISTÓRICA (#237) ════════');
  console.log(`Generado: ${new Date().toISOString()}\n`);

  // 1. Ventana de temporadas (cruzadas) — #224/#229/#327
  const ventana = await q('ventana', `
    SELECT count(*)::int AS fuera_ventana FROM matches m JOIN seasons s ON s.id=m.season_id
     WHERE s.start_date IS NOT NULL AND s.end_date IS NOT NULL AND m.scheduled_at IS NOT NULL
       AND (m.scheduled_at < s.start_date - INTERVAL '45 days' OR m.scheduled_at > s.end_date + INTERVAL '45 days')`);
  console.log(`1) Partidos fuera de la ventana de su temporada: ${ventana[0]!.fuera_ventana}`);

  // 2. Marcadores vs eventos (con administrativos aparte) — #225/#205
  const marcador = await q('marcador', `
    WITH goles AS (
      SELECT m.id, m.home_score, m.away_score, m.source_ref,
             COUNT(*) FILTER (WHERE e.event_type='goal' AND e.team_id = m.home_team_id) AS hg,
             COUNT(*) FILTER (WHERE e.event_type='goal' AND e.team_id = m.away_team_id) AS ag
        FROM matches m JOIN match_events e ON e.match_id = m.id
       WHERE m.status='finished' AND m.event_coverage='full'
         AND m.home_score IS NOT NULL AND m.away_score IS NOT NULL
       GROUP BY m.id, m.home_score, m.away_score, m.source_ref)
    SELECT count(*) FILTER (WHERE NOT (hg=home_score AND ag=away_score))::int AS mismatch,
           count(*) FILTER (WHERE NOT (hg=home_score AND ag=away_score)
             AND ((home_score=10 AND away_score=0) OR (home_score=0 AND away_score=10)))::int AS administrativos,
           count(*)::int AS total FROM goles`);
  console.log(`2) Marcador≠eventos: ${marcador[0]!.mismatch}/${marcador[0]!.total} (administrativos ${marcador[0]!.administrativos}) — resto en #205`);

  // 3. Standings vs partidos — #226
  const standings = await q('standings', `
    WITH pj_real AS (
      SELECT st.season_id, st.team_id, COUNT(m.id) FILTER (WHERE m.status='finished') AS pj
        FROM standings st
        LEFT JOIN matches m ON m.season_id=st.season_id AND (m.home_team_id=st.team_id OR m.away_team_id=st.team_id)
       GROUP BY st.season_id, st.team_id)
    SELECT count(*)::int AS mismatch FROM pj_real r JOIN standings st ON st.season_id=r.season_id AND st.team_id=r.team_id
     WHERE COALESCE(st.played,0) <> r.pj`);
  console.log(`3) Standings con PJ ≠ partidos finished: ${standings[0]!.mismatch} — campaña de recálculo en #226`);

  // 4. Actas del histórico: cobertura de eventos en importados — #232
  const actas = await q('actas', `
    SELECT (m.import_batch_id IS NOT NULL) AS del_import, count(*)::int AS total,
           count(*) FILTER (WHERE EXISTS (SELECT 1 FROM match_events e WHERE e.match_id=m.id))::int AS con_acta,
           count(*) FILTER (WHERE m.event_coverage='full')::int AS coverage_full
      FROM matches m WHERE m.status='finished' GROUP BY 1 ORDER BY 1`);
  for (const r of actas) {
    console.log(`4) ${r.del_import ? 'import histórico' : 'prod viva '}: ${r.con_acta}/${r.total} con acta (${r.coverage_full} coverage=full) — campaña en #232`);
  }

  // 5. Súper-equipos (historial mezclado) — #192
  const superEquipos = await q('super', `
    WITH mezcla AS (
      SELECT t.id, t.name, COUNT(DISTINCT c.gender) AS g, COUNT(DISTINCT c.age_category) AS cat
        FROM teams t JOIN season_teams st ON st.team_id=t.id
        JOIN seasons s ON s.id=st.season_id JOIN competitions c ON c.id=s.competition_id
       WHERE c.gender IS NOT NULL GROUP BY t.id, t.name HAVING COUNT(DISTINCT c.gender) > 1)
    SELECT count(*)::int AS n, left(string_agg(name, ', '), 200) AS nombres FROM mezcla`);
  console.log(`5) Súper-equipos con géneros mezclados: ${superEquipos[0]!.n}${superEquipos[0]!.n > 0 ? ` — ${superEquipos[0]!.nombres}` : ''}`);

  // 6. Homónimos en temporada y refs compartidas — #193
  const homonimos = await q('homonimos', `
    WITH nom AS (
      SELECT st.season_id, lower(regexp_replace(t.name, '\\s+', ' ', 'g')) AS nombre, count(DISTINCT t.id) AS equipos
        FROM season_teams st JOIN teams t ON t.id=st.team_id
       GROUP BY st.season_id, lower(regexp_replace(t.name, '\\s+', ' ', 'g')) HAVING count(DISTINCT t.id) > 1)
    SELECT count(*)::int AS n FROM nom`);
  const refs = await q('refs', `
    WITH vivos AS (
      SELECT DISTINCT t.source_ref FROM teams t
       JOIN season_teams st ON st.team_id=t.id JOIN seasons s ON s.id=st.season_id AND s.is_current
      WHERE t.source_ref IS NOT NULL)
    SELECT count(*)::int AS n FROM (SELECT source_ref FROM vivos GROUP BY source_ref HAVING count(*)>1) x`);
  console.log(`6) Homónimos en temporada: ${homonimos[0]!.n} · refs compartidas (equipos vivos): ${refs[0]!.n}`);

  // 7. Partidos sin season_teams (fichas "sin partidos") — #148
  const sinSt = await q('sin_st', `
    WITH jugadores AS (
      SELECT s.id AS season_id, t.id AS team_id, COUNT(m.id) FILTER (WHERE m.status='finished') AS pj
        FROM seasons s JOIN teams t ON true
        JOIN matches m ON m.season_id=s.id AND (m.home_team_id=t.id OR m.away_team_id=t.id)
       WHERE s.is_current GROUP BY s.id, t.id HAVING COUNT(m.id) FILTER (WHERE m.status='finished') > 0)
    SELECT count(*)::int AS n FROM jugadores j
     WHERE NOT EXISTS (SELECT 1 FROM season_teams st WHERE st.season_id=j.season_id AND st.team_id=j.team_id)`);
  console.log(`7) Equipos con partidos sin season_teams (temp. actuales): ${sinSt[0]!.n}`);

  // 8. Ganadores imposibles — #326
  const winner = await q('winner', `
    SELECT count(*)::int AS n FROM matches
     WHERE winner_team_id IS NOT NULL AND COALESCE(win_type,'regular') <> 'penalties'
       AND home_score IS NOT DISTINCT FROM away_score`);
  console.log(`8) Ganadores imposibles (empate sin tanda): ${winner[0]!.n} — CHECK 059 activo`);

  // 9. Eventos anómalos — #207
  const period = await q('period', `SELECT count(*)::int AS n FROM match_events WHERE period IS NOT NULL AND (period < 1 OR period > 4)`);
  const intrusos = await q('intrusos', `
    SELECT count(*)::int AS n FROM match_events e JOIN matches m ON m.id=e.match_id
     WHERE e.team_id IS NOT NULL AND e.team_id <> m.home_team_id AND e.team_id <> m.away_team_id`);
  console.log(`9) Eventos con period fuera de 1..4: ${period[0]!.n} (#207) · equipos intrusos: ${intrusos[0]!.n} (#325)`);

  // 10. Alineaciones sin vínculo — #219
  const lineups = await q('lineups', `
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE player_id IS NULL)::int AS sin_link,
           count(*) FILTER (WHERE player_source_ref IS NOT NULL)::int AS con_ref
      FROM match_lineups`);
  const pct = lineups[0]!.total > 0 ? Math.round((1 - lineups[0]!.sin_link / lineups[0]!.total) * 100) : 100;
  console.log(`10) Alineaciones sin vínculo: ${lineups[0]!.sin_link}/${lineups[0]!.total} (${pct}% enlazadas; con ref de acta: ${lineups[0]!.con_ref}) — backfill en #219/#232`);

  // 11. Rondas huérfanas — #211
  const rondas = await q('rondas', `SELECT count(*)::int AS n FROM rounds r WHERE NOT EXISTS (SELECT 1 FROM matches m WHERE m.round_id=r.id)`);
  console.log(`11) Rondas huérfanas: ${rondas[0]!.n} (#211)`);

  // 12. Centinela undated — invariante 047
  const undated = await q('undated', `SELECT count(*)::int AS n FROM match_events_undated`);
  console.log(`12) match_events_undated: ${undated[0]!.n} (debe ser 0)`);

  console.log('\nLos items con deuda activa referencian su issue de campaña. Alertas diarias: #231.');
  log.info('Informe de integridad histórica generado');
}

// Sólo se ejecuta al lanzarlo directamente (no al importarlo).
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main()
    .catch((err) => {
      log.error({ err }, 'audit-integrity-report falló');
      Sentry.captureException(err);
      process.exitCode = 1;
    })
    .finally(async () => {
      await Sentry.flush(2000);
      await closeDb();
    });
}
