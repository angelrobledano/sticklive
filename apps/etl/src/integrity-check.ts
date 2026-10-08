// Sentry PRIMERO: instrument interceptando la carga de módulos (ver instrument.ts).
import './instrument.js';
import * as Sentry from '@sentry/node';
import { pathToFileURL } from 'node:url';
import { createLogger } from '@sports/logger';
import { db, closeDb } from '@sports/db';

/**
 * Chequeo diario de integridad de datos (#231, complementa a #193 y #148).
 *
 * El enrich y las reparaciones puntuales corrigen datos; este script comprueba
 * CADA DÍA que las invariantes se siguen cumpliendo, sobre la base real:
 *
 *   1. VENTANA (#229/#327): partidos con scheduled_at fuera de la ventana de su
 *      temporada [start−45d, end+45d] (solo temporadas con fechas completas).
 *   2. EVENTOS↔MARCADOR (#205/#207): partidos finished con acta completa cuyo
 *      marcador no cuadra con los goles de los eventos (los administrativos
 *      10-0/0-10 se cuentan aparte, son legítimos).
 *   3. STANDINGS↔PARTIDOS (#226): PJ de la clasificación ≠ partidos finished
 *      reales del equipo en la temporada.
 *   4. HOMÓNIMOS EN TEMPORADA (#193): dos equipos distintos con el mismo nombre
 *      normalizado en season_teams de la misma temporada (el detector genérico
 *      del bug Cerdanyola).
 *   5. REFS COMPARTIDAS (#193): dos equipos vivos (con season_teams en
 *      temporadas actuales) compartiendo source_ref.
 *   6. PARTIDOS SIN SEASON_TEAMS (#148): equipos con partidos jugados en la
 *      temporada actual pero ausentes de season_teams — la firma exacta de la
 *      ficha "sin partidos" de Plata.
 *   7. GANADOR IMPOSIBLE (#326): winner con marcador empatado sin tanda. Con el
 *      CHECK de la 059 debería ser 0 siempre; si no lo es, alguien saltó la BD.
 *
 * Cada check tiene umbral por env (0 por defecto): se alerta si violaciones >
 * umbral. Salida: una línea por check con su número, y exit code SIEMPRE 0
 * (es un alertador, no una puerta — que no tumbe el scheduler).
 *
 * Uso:  node dist/apps/etl/src/integrity-check.js
 * Env:  INTEGRITY_THRESHOLD_VENTANA / _MARCADOR / _STANDINGS / _HOMONIMOS /
 *       _REFS / _SEASON_TEAMS / _WINNER (violaciones toleradas, defecto 0)
 */

const log = createLogger({ service: 'integrity-check' });

interface CheckResult {
  name: string;
  violations: number;
  detail?: string;
  threshold: number;
}

const threshold = (suffix: string): number =>
  Number(process.env[`INTEGRITY_THRESHOLD_${suffix}`] ?? 0);

async function checkVentana(): Promise<CheckResult> {
  const { rows } = await db.query<{ n: string; muestra: string | null }>(
    `SELECT count(*)::text AS n,
            left(string_agg(m.source_ref, ', ' ORDER BY m.scheduled_at), 200) AS muestra
       FROM matches m
       JOIN seasons s ON s.id = m.season_id
      WHERE s.start_date IS NOT NULL AND s.end_date IS NOT NULL
        AND m.scheduled_at IS NOT NULL
        AND (m.scheduled_at < s.start_date - INTERVAL '45 days'
          OR m.scheduled_at > s.end_date + INTERVAL '45 days')`
  );
  return { name: 'ventana', violations: Number(rows[0]!.n), detail: rows[0]!.muestra ?? undefined, threshold: threshold('VENTANA') };
}

async function checkMarcador(): Promise<CheckResult> {
  // Goles por equipo desde eventos vs marcador. Solo finished + acta completa.
  // Los administrativos (10-0 / 0-10) se reportan aparte: sin acta que cuadre.
  const { rows } = await db.query<{ n: string; administrativos: string; muestra: string | null }>(
    `WITH goles AS (
       SELECT m.id,
              COUNT(*) FILTER (WHERE e.event_type='goal' AND e.team_id = m.home_team_id) AS hg,
              COUNT(*) FILTER (WHERE e.event_type='goal' AND e.team_id = m.away_team_id) AS ag
         FROM matches m
         JOIN match_events e ON e.match_id = m.id
        WHERE m.status = 'finished' AND m.event_coverage = 'full'
          AND m.home_score IS NOT NULL AND m.away_score IS NOT NULL
        GROUP BY m.id, m.home_team_id, m.away_team_id, m.home_score, m.away_score
     )
     SELECT count(*) FILTER (WHERE NOT (hg = home_score AND ag = away_score))::text AS n,
            count(*) FILTER (WHERE NOT (hg = home_score AND ag = away_score)
                             AND ((home_score = 10 AND away_score = 0) OR (home_score = 0 AND away_score = 10)))::text AS administrativos,
            left(string_agg(m2.source_ref, ', '), 200) AS muestra
       FROM goles g JOIN matches m2 ON m2.id = g.id
      WHERE NOT (hg = home_score AND ag = away_score)`
  );
  return { name: 'marcador', violations: Number(rows[0]!.n), detail: `administrativos=${rows[0]!.administrativos} ${rows[0]!.muestra ?? ''}`, threshold: threshold('MARCADOR') };
}

async function checkStandings(): Promise<CheckResult> {
  const { rows } = await db.query<{ n: string; muestra: string | null }>(
    `WITH pj_real AS (
       SELECT st.season_id, st.team_id, COUNT(m.id) FILTER (WHERE m.status = 'finished') AS pj
         FROM standings st
         LEFT JOIN matches m
           ON m.season_id = st.season_id AND (m.home_team_id = st.team_id OR m.away_team_id = st.team_id)
        GROUP BY st.season_id, st.team_id
     )
     SELECT count(*)::text AS n,
            left(string_agg(s2.id::text || '/' || t.name, ', '), 200) AS muestra
       FROM pj_real r
       JOIN standings st ON st.season_id = r.season_id AND st.team_id = r.team_id
       JOIN seasons s2 ON s2.id = r.season_id
       JOIN teams t ON t.id = r.team_id
      WHERE COALESCE(st.played, 0) <> r.pj`
  );
  return { name: 'standings', violations: Number(rows[0]!.n), detail: rows[0]!.muestra ?? undefined, threshold: threshold('STANDINGS') };
}

async function checkHomonimos(): Promise<CheckResult> {
  const { rows } = await db.query<{ n: string; muestra: string | null }>(
    `WITH nombre_normalizado AS (
       SELECT st.season_id, s2.name AS temporada, lower(regexp_replace(t.name, '\\s+', ' ', 'g')) AS nombre,
              count(DISTINCT t.id) AS equipos, left(string_agg(DISTINCT t.name, ' ⧸ '), 200) AS nombres
         FROM season_teams st
         JOIN teams t ON t.id = st.team_id
         JOIN seasons s2 ON s2.id = st.season_id
        GROUP BY st.season_id, s2.name, lower(regexp_replace(t.name, '\\s+', ' ', 'g'))
       HAVING count(DISTINCT t.id) > 1
     )
     SELECT count(*)::text AS n, left(string_agg(temporada || ': ' || nombres, ' | '), 300) AS muestra
       FROM nombre_normalizado`
  );
  return { name: 'homonimos', violations: Number(rows[0]!.n), detail: rows[0]!.muestra ?? undefined, threshold: threshold('HOMONIMOS') };
}

async function checkRefsCompartidas(): Promise<CheckResult> {
  // Solo equipos VIVOS (con season_teams en temporadas is_current): el legado
  // histórico tiene refs genuinamente compartidas por diseño (#193).
  // La muestra necesita DOS niveles de agregación (nombres por ref → unión de
  // refs): en una sola pasaba un string_agg dentro de otro string_agg y
  // Postgres rechazaba el check entero ("aggregate function calls cannot be
  // nested", NODE-API-BACKEND-C).
  const { rows } = await db.query<{ n: string; muestra: string | null }>(
    `WITH vivos AS (
       SELECT DISTINCT t.id, t.name, t.source_ref
         FROM teams t
         JOIN season_teams st ON st.team_id = t.id
         JOIN seasons s ON s.id = st.season_id AND s.is_current
        WHERE t.source_ref IS NOT NULL
     ),
     por_ref AS (
       SELECT source_ref, string_agg(name, ' ⧸ ') AS nombres, count(*) AS n
         FROM vivos
        GROUP BY source_ref
       HAVING count(*) > 1
     )
     SELECT count(*)::text AS n,
            left(string_agg('ref ' || source_ref || ': ' || nombres, ' | '), 300) AS muestra
       FROM por_ref`
  );
  return { name: 'refs-compartidas', violations: Number(rows[0]!.n), detail: rows[0]!.muestra ?? undefined, threshold: threshold('REFS') };
}

async function checkSeasonTeams(): Promise<CheckResult> {
  // #148: equipos con partidos jugados en la temporada actual pero fuera de
  // season_teams — la ficha muestra "Sin partidos" pese a jugar.
  const { rows } = await db.query<{ n: string; muestra: string | null }>(
    `WITH jugadores AS (
       SELECT s.id AS season_id, s.name AS temporada, t.id AS team_id, t.name AS equipo,
              COUNT(m.id) FILTER (WHERE m.status = 'finished') AS pj
         FROM seasons s
         JOIN teams t ON true
         JOIN matches m ON m.season_id = s.id AND (m.home_team_id = t.id OR m.away_team_id = t.id)
        WHERE s.is_current
        GROUP BY s.id, s.name, t.id, t.name
       HAVING COUNT(m.id) FILTER (WHERE m.status = 'finished') > 0
     )
     SELECT count(*)::text AS n,
            left(string_agg(temporada || ': ' || equipo || ' (PJ ' || pj || ')', ' | '), 300) AS muestra
       FROM jugadores j
      WHERE NOT EXISTS (
        SELECT 1 FROM season_teams st
         WHERE st.season_id = j.season_id AND st.team_id = j.team_id
      )`
  );
  return { name: 'season-teams', violations: Number(rows[0]!.n), detail: rows[0]!.muestra ?? undefined, threshold: threshold('SEASON_TEAMS') };
}

async function checkWinner(): Promise<CheckResult> {
  const { rows } = await db.query<{ n: string; muestra: string | null }>(
    `SELECT count(*)::text AS n, left(string_agg(source_ref, ', '), 200) AS muestra
       FROM matches
      WHERE winner_team_id IS NOT NULL
        AND COALESCE(win_type, 'regular') <> 'penalties'
        AND home_score IS NOT DISTINCT FROM away_score`
  );
  return { name: 'winner-imposible', violations: Number(rows[0]!.n), detail: rows[0]!.muestra ?? undefined, threshold: threshold('WINNER') };
}

async function main(): Promise<void> {
  log.info('→ Chequeo de integridad (#231)');
  const results = await Promise.all([
    checkVentana(), checkMarcador(), checkStandings(), checkHomonimos(),
    checkRefsCompartidas(), checkSeasonTeams(), checkWinner(),
  ]);

  let alerts = 0;
  for (const r of results) {
    const ok = r.violations <= r.threshold;
    if (ok) {
      log.info({ check: r.name, violations: r.violations, threshold: r.threshold }, `✅ ${r.name}: OK`);
      continue;
    }
    alerts++;
    const msg = `Integridad: check '${r.name}' con ${r.violations} violaciones (umbral ${r.threshold})${r.detail ? ` — ${r.detail}` : ''}`;
    log.error({ check: r.name, violations: r.violations, detail: r.detail }, `❌ ${msg}`);
    Sentry.captureMessage(msg, { level: 'warning', tags: { check: r.name }, extra: { violations: r.violations, detail: r.detail } });
  }

  log.info({ alerts, checks: results.length }, alerts === 0 ? 'Integridad OK' : 'Integridad: con alertas');
}

// Solo se ejecuta al lanzarlo directamente (scheduler), no al importarlo (tests).
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main()
    .catch((err) => {
      log.error({ err }, 'integrity-check falló');
      Sentry.captureException(err);
      process.exitCode = 1;
    })
    .finally(async () => {
      await Sentry.flush(2000);
      await closeDb();
    });
}
