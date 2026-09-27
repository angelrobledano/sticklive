/**
 * Consultas del embudo de resolución de entidades (Fase 1).
 *
 * Escalón 1 — `source_entity_map`: ID de fuente → team (determinista).
 * Escalón 2 — `team_aliases`: nombre normalizado → team (caché exacta).
 *
 * Estas funciones son sólo lectura/escritura puntual; la cascada de decisión
 * vive en el ETL (apps/etl/src/loaders/ref-resolver.ts). Ver
 * docs/ARQUITECTURA_ENTITY_RESOLUTION.md §3.
 */
import pg from 'pg';
import { db, withTransaction } from '../client.js';

type Ejecutor = pg.PoolClient | typeof db;

/**
 * Escalón 1: resuelve un ref de fuente a team_id vía `source_entity_map`.
 * Si se pasa `sourceId`, respeta la clave (source_id, source_ref); si no, busca
 * por ref en cualquier fuente (útil para refs globalmente únicos como los FEP).
 */
export async function resolveTeamViaSourceMap(
  sourceRef: string,
  sourceId?: string,
): Promise<string | null> {
  const { rows } = sourceId
    ? await db.query<{ team_id: string }>(
        `SELECT team_id FROM source_entity_map
          WHERE source_id = $2 AND source_ref = $1 AND team_id IS NOT NULL
          LIMIT 1`,
        [sourceRef, sourceId],
      )
    : await db.query<{ team_id: string }>(
        `SELECT team_id FROM source_entity_map
          WHERE source_ref = $1 AND team_id IS NOT NULL
          LIMIT 1`,
        [sourceRef],
      );
  return rows[0]?.team_id ?? null;
}

/**
 * Alimenta el escalón 1: registra (fuente, ref) → team. Idempotente; no pisa un
 * mapeo existente (ON CONFLICT DO NOTHING). Best-effort desde el ETL.
 */
export async function upsertSourceEntityMapTeam(
  sourceId: string,
  sourceRef: string,
  teamId: string,
  client: Ejecutor = db,
): Promise<void> {
  await client.query(
    `INSERT INTO source_entity_map (source_id, source_ref, team_id)
          VALUES ($1, $2, $3)
     ON CONFLICT (source_id, source_ref) DO NOTHING`,
    [sourceId, sourceRef, teamId],
  );
}

/**
 * Escalón 2: nombre normalizado → team_id, match EXACTO sobre `team_aliases`.
 * Sólo aliases `confirmed`. Con `sourceId`, prioriza el de la misma fuente.
 */
export async function findTeamByNormalizedAlias(
  normalized: string,
  sourceId?: string,
): Promise<string | null> {
  const { rows } = await db.query<{ team_id: string }>(
    `SELECT team_id FROM team_aliases
      WHERE normalized = $1 AND status = 'confirmed'
      ORDER BY ($2::uuid IS NOT NULL AND source_id = $2) DESC NULLS LAST,
               confidence DESC
      LIMIT 1`,
    [normalized, sourceId ?? null],
  );
  return rows[0]?.team_id ?? null;
}

export interface UpsertTeamAliasInput {
  teamId: string;
  rawText: string;
  normalized: string;
  sourceId?: string | null;
  createdBy: string;            // 'deterministic' | 'fuzzy' | 'llm' | 'human:<user>'
  confidence?: number;
  status?: 'confirmed' | 'pending' | 'rejected';
}

/**
 * Alimenta el escalón 2. Idempotente por (normalized, source_id): no duplica ni
 * pisa un alias existente. Best-effort desde el ETL/backfill.
 */
export async function upsertTeamAlias(
  input: UpsertTeamAliasInput,
  client: Ejecutor = db,
): Promise<void> {
  await client.query(
    `INSERT INTO team_aliases (team_id, raw_text, normalized, source_id, confidence, status, created_by)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (normalized, source_id) DO NOTHING`,
    [
      input.teamId,
      input.rawText,
      input.normalized,
      input.sourceId ?? null,
      input.confidence ?? 1.0,
      input.status ?? 'confirmed',
      input.createdBy,
    ],
  );
}

// ── Fase 2: fuzzy con bloqueo (escalón 3) + cola HITL (escalón 4) ────────────

export interface FuzzyCandidate {
  teamId: string;
  name: string;
  score: number;
}

/**
 * Escalón 3: genera candidatos por similitud de trigramas sobre `team_aliases`,
 * ACOTADO por deporte (clave de bloqueo básica) y por el operador `%`, que usa
 * el índice GIN y el umbral de pg_trgm (evita el O(n²)). NO decide: sólo propone
 * top-N para la cola/panel. Un candidato por team (máxima similitud de sus aliases).
 */
export async function generateFuzzyCandidates(
  normalized: string,
  sportId: string,
  limit = 3,
): Promise<FuzzyCandidate[]> {
  const { rows } = await db.query<{ team_id: string; name: string; score: number }>(
    `SELECT ta.team_id, t.name, MAX(similarity(ta.normalized, $1))::float AS score
       FROM team_aliases ta
       JOIN teams t ON t.id = ta.team_id
      WHERE t.sport_id = $2
        AND ta.status = 'confirmed'
        AND ta.normalized % $1
      GROUP BY ta.team_id, t.name
      ORDER BY score DESC
      LIMIT $3`,
    [normalized, sportId, limit],
  );
  return rows.map((r) => ({ teamId: r.team_id, name: r.name, score: Number(r.score) }));
}

export interface SimilarNameCandidate {
  teamId: string;
  name: string;
  gender: string | null;
  score: number;
}

/**
 * Candidatos por similitud de NOMBRE contra los equipos existentes.
 *
 * `generateFuzzyCandidates` busca en `team_aliases`, que solo cubre los equipos
 * ya aprendidos. Antes de dar de alta una temporada nueva hace falta comparar
 * contra los nombres REALES de los equipos del mismo deporte, para detectar
 * clubs renombrados por patrocinio (p. ej. "OXIGEN PHC SANT CUGAT" →
 * "VICIO PHC SANT CUGAT") y no crear un duplicado.
 *
 * Bloqueo por deporte, con género/categoría PERMISIVOS: hay equipos históricos
 * con `gender`/`age_category` NULL y excluirlos haría perder al candidato bueno.
 * El umbral es bajo a propósito: esto solo decide "¿hay que preguntar?".
 */
export async function findSimilarTeamNames(
  name: string,
  sportId: string,
  opts?: { gender?: string | null; ageCategory?: string | null },
  limit = 3,
): Promise<SimilarNameCandidate[]> {
  const { rows } = await db.query<{ team_id: string; name: string; gender: string | null; score: number }>(
    `SELECT t.id AS team_id, t.name, t.gender, similarity(lower(t.name), lower($1))::float AS score
       FROM teams t
      WHERE t.sport_id = $2
        AND ($3::text IS NULL OR t.gender = $3 OR t.gender IS NULL)
        AND ($4::text IS NULL OR t.age_category = $4 OR t.age_category IS NULL)
        AND similarity(lower(t.name), lower($1)) >= 0.35
      ORDER BY score DESC, t.name
      LIMIT $5`,
    [name, sportId, opts?.gender ?? null, opts?.ageCategory ?? null, limit],
  );
  return rows.map((r) => ({ teamId: r.team_id, name: r.name, gender: r.gender, score: Number(r.score) }));
}

export interface EnqueueResolutionInput {
  rawText: string;
  normalized: string;
  sourceId: string;
  sourceRef?: string | null;
  context?: Record<string, unknown>;
  candidates?: FuzzyCandidate[];
}

/**
 * Escalón 4: aparca en `resolution_queue` un ref que no se resolvió con
 * confianza. Una entrada por (normalized, source_id); reencolar sólo incrementa
 * `occurrences` (prioridad del panel) y refresca candidatos, y SÓLO si el ítem
 * sigue `pending` (no toca lo ya resuelto/rechazado por un humano).
 */
export async function enqueueResolution(
  input: EnqueueResolutionInput,
  client: Ejecutor = db,
): Promise<void> {
  await client.query(
    `INSERT INTO resolution_queue (raw_text, normalized, source_id, source_ref, context, candidates)
          VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)
     ON CONFLICT (normalized, source_id) DO UPDATE
        SET occurrences = resolution_queue.occurrences + 1,
            candidates  = EXCLUDED.candidates,
            updated_at  = NOW()
      WHERE resolution_queue.status = 'pending'`,
    [
      input.rawText,
      input.normalized,
      input.sourceId,
      input.sourceRef ?? null,
      JSON.stringify(input.context ?? {}),
      JSON.stringify(input.candidates ?? []),
    ],
  );
}

// ── Fase 2b: panel HITL (lectura + resolución) ─────────────────────────

export interface ResolutionQueueItem {
  id: string;
  rawText: string;
  normalized: string;
  sourceId: string;
  sourceRef: string | null;
  context: Record<string, unknown>;
  candidates: FuzzyCandidate[];
  occurrences: number;
  status: string;
  resolvedTeamId: string | null;
  createdAt: Date;
}

/** Bandeja del panel: ordenada por impacto (occurrences) entre los de un estado. */
export async function listResolutionQueue(
  status = 'pending',
  limit = 100,
): Promise<ResolutionQueueItem[]> {
  const { rows } = await db.query<{
    id: string; raw_text: string; normalized: string; source_id: string;
    source_ref: string | null; context: Record<string, unknown>;
    candidates: FuzzyCandidate[]; occurrences: number; status: string;
    resolved_team_id: string | null; created_at: Date;
  }>(
    `SELECT id, raw_text, normalized, source_id, source_ref, context, candidates,
            occurrences, status, resolved_team_id, created_at
       FROM resolution_queue
      WHERE status = $1
      ORDER BY occurrences DESC, created_at ASC
      LIMIT $2`,
    [status, limit],
  );
  return rows.map((r) => ({
    id: r.id, rawText: r.raw_text, normalized: r.normalized, sourceId: r.source_id,
    sourceRef: r.source_ref, context: r.context, candidates: r.candidates,
    occurrences: r.occurrences, status: r.status, resolvedTeamId: r.resolved_team_id,
    createdAt: r.created_at,
  }));
}

/**
 * Resuelve un ítem de la cola: lo marca `resolved`, apunta al team elegido y
 * ESCRIBE el alias (created_by='human:…', confirmed). Así la próxima resolución
 * de ese nombre entra por el escalón 2 (aprendizaje) y jamás vuelve a la cola.
 * Idempotente: si el ítem ya no está `pending`, devuelve null sin tocar nada.
 */
export async function resolveQueueItem(
  id: string,
  teamId: string,
  createdBy = 'human',
): Promise<{ id: string; teamId: string } | null> {
  return withTransaction(async (client) => {
    const { rows } = await client.query<{ normalized: string; source_id: string; raw_text: string }>(
      `SELECT normalized, source_id, raw_text FROM resolution_queue
        WHERE id = $1 AND status = 'pending' FOR UPDATE`,
      [id],
    );
    const item = rows[0];
    if (!item) return null;

    await client.query(
      `UPDATE resolution_queue
          SET status = 'resolved', resolved_team_id = $2, updated_at = NOW()
        WHERE id = $1`,
      [id, teamId],
    );
    await upsertTeamAlias(
      {
        teamId,
        rawText: item.raw_text,
        normalized: item.normalized,
        sourceId: item.source_id,
        createdBy,
        confidence: 1.0,
        status: 'confirmed',
      },
      client,
    );
    return { id, teamId };
  });
}

/** Descarta un ítem (ruido, no es un club real). No crea alias. */
export async function rejectQueueItem(id: string): Promise<boolean> {
  const { rowCount } = await db.query(
    `UPDATE resolution_queue SET status = 'rejected', updated_at = NOW()
      WHERE id = $1 AND status = 'pending'`,
    [id],
  );
  return (rowCount ?? 0) > 0;
}

// ── Fase 3: auto-confirmación con señales de dominio ────────────────────────

export interface EntitySignals {
  gender: string | null;
  ageCategory: string | null;
}

/** Señales de dominio (género/categoría) de la competición de una temporada. */
export async function getSeasonSignals(seasonId: string): Promise<EntitySignals> {
  const { rows } = await db.query<{ gender: string | null; age_category: string | null }>(
    `SELECT c.gender, c.age_category
       FROM seasons s JOIN competitions c ON c.id = s.competition_id
      WHERE s.id = $1`,
    [seasonId],
  );
  return { gender: rows[0]?.gender ?? null, ageCategory: rows[0]?.age_category ?? null };
}

/**
 * Fase 3: auto-confirmación. Devuelve el team SÓLO si hay un candidato con
 * similitud ≥ `minScore` Y señales consistentes (mismo género y categoría) Y es
 * inequívoco (hueco ≥ `gap` con el 2º). Ante la duda, null (se encola). El
 * género+categoría son más discriminantes que el nombre: son los que evitan el
 * falso positivo semántico. Nunca fusiona a ciegas.
 */
export async function autoConfirmTeam(
  normalized: string,
  sportId: string,
  gender: string,
  ageCategory: string,
  minScore = 0.95,
  gap = 0.05,
): Promise<FuzzyCandidate | null> {
  const { rows } = await db.query<{ team_id: string; name: string; score: number }>(
    `SELECT ta.team_id, t.name, MAX(similarity(ta.normalized, $1))::float AS score
       FROM team_aliases ta
       JOIN teams t ON t.id = ta.team_id
      WHERE t.sport_id = $2
        AND ta.status = 'confirmed'
        AND ta.normalized % $1
        AND t.gender = $3
        AND t.age_category = $4
      GROUP BY ta.team_id, t.name
     HAVING MAX(similarity(ta.normalized, $1)) >= $5
      ORDER BY score DESC
      LIMIT 2`,
    [normalized, sportId, gender, ageCategory, minScore],
  );
  const top = rows[0];
  if (!top) return null;
  const second = rows[1];
  if (second && top.score - Number(second.score) < gap) return null; // ambiguo → no auto
  return { teamId: top.team_id, name: top.name, score: Number(top.score) };
}

// ── Salud del embudo (métrica arch §5.3) ──────────────────────────────

export interface ResolutionStats {
  queue: { pending: number; resolved: number; rejected: number; pendingOccurrences: number };
  aliases: { deterministic: number; fuzzy: number; human: number; total: number };
}

/**
 * Snapshot de salud del embudo. Lo clave (arch §5.3): cuánto se aparca (backlog
 * `pending` y sus `occurrences`, que debe decaer) y cuánto aprende el sistema
 * (aliases por origen: `deterministic` de arranque, `fuzzy` auto-confirmados,
 * `human` de las resoluciones del panel).
 */
export async function getResolutionStats(): Promise<ResolutionStats> {
  const q = await db.query<{ status: string; n: string; occ: string }>(
    `SELECT status, COUNT(*)::int AS n, COALESCE(SUM(occurrences), 0)::int AS occ
       FROM resolution_queue GROUP BY status`,
  );
  const st = (s: string) => q.rows.find((r) => r.status === s);

  const a = await db.query<{ bucket: string; n: string }>(
    `SELECT CASE WHEN created_by LIKE 'human%' THEN 'human' ELSE created_by END AS bucket,
            COUNT(*)::int AS n
       FROM team_aliases GROUP BY bucket`,
  );
  const al = (b: string) => Number(a.rows.find((r) => r.bucket === b)?.n ?? 0);

  return {
    queue: {
      pending: Number(st('pending')?.n ?? 0),
      resolved: Number(st('resolved')?.n ?? 0),
      rejected: Number(st('rejected')?.n ?? 0),
      pendingOccurrences: Number(st('pending')?.occ ?? 0),
    },
    aliases: {
      deterministic: al('deterministic'),
      fuzzy: al('fuzzy'),
      human: al('human'),
      total: a.rows.reduce((s, r) => s + Number(r.n), 0),
    },
  };
}
