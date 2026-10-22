import { Hono } from 'hono';
import { timingSafeEqual } from 'node:crypto';
import { db, archiveCompetition, restoreCompetition, mergeCompetitions, findDuplicateCandidates, listArchivedCompetitions, listResolutionQueue, resolveQueueItem, rejectQueueItem, getResolutionStats, listPlayerLinkCandidates, listCrestReviewGroups, describeTeams, generatePlayerLinkCandidates, acceptPlayerLinkCandidate, rejectPlayerLinkCandidate, getStandingsZones, replaceStandingsZones, copyStandingsZones, listCompetitionsForQuality, setCompetitionQuality, listSeasonsForQuality, setSeasonQuality, type DataQuality } from '@sports/db';
import { logger } from '@sports/logger';
import type { StandingsZone } from '@sports/shared-types';
import { isUuid } from '../lib/uuid.js';
import { captureRouteError } from '../lib/route-error.js';

/**
 * Panel de administracion nivel 1 (token compartido).
 *
 * Autenticacion: cabecera X-Admin-Token comparada (en tiempo constante)
 * con la variable de entorno ADMIN_TOKEN.
 */

export const adminRouter = new Hono();

function tokenOk(header: string | undefined): boolean {
  const expected = process.env['ADMIN_TOKEN'];
  if (!expected || !header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

adminRouter.use('*', async (c, next) => {
  if (!process.env['ADMIN_TOKEN']) {
    return c.json({ error: 'Admin disabled: ADMIN_TOKEN not configured' }, 503);
  }
  if (!tokenOk(c.req.header('x-admin-token'))) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  await next();
});

adminRouter.get('/users', async (c) => {
  try {
    const res = await db.query(`
      SELECT
        u.id,
        u.email,
        u.device_id,
        u.status,
        u.is_premium,
        u.premium_until,
        u.created_at,
        u.updated_at,
        (EXISTS (SELECT 1 FROM user_sessions s
                  WHERE s.user_id = u.id AND s.expires_at > NOW())) AS has_session,
        COUNT(f.id)::int                                 AS favorites
      FROM users u
      LEFT JOIN user_favorites f ON f.user_id = u.id
      GROUP BY u.id
      ORDER BY u.created_at DESC
    `);

    const users = res.rows.map((r) => ({
      id:           r.id,
      email:        r.email,
      deviceId:     r.device_id,
      status:       r.status,
      isPremium:    r.is_premium,
      premiumUntil: r.premium_until,
      createdAt:    r.created_at,
      updatedAt:    r.updated_at,
      hasSession:   r.has_session,
      favorites:    r.favorites,
    }));

    return c.json({
      total:      users.length,
      withEmail:  users.filter((u) => u.email).length,
      premium:    users.filter((u) => u.isPremium).length,
      disabled:   users.filter((u) => u.status === 'disabled').length,
      users,
    });
  } catch (err) {
    captureRouteError(err, 'admin] error');
    logger.error({ err }, '[admin] error');
    return c.json({ error: 'Database error' }, 500);
  }
});

adminRouter.patch('/users/:id/status', async (c) => {
  const id = c.req.param('id');
  // Un id no-UUID haría fallar el cast a uuid de Postgres → 500 (#321).
  if (!isUuid(id)) return c.json({ error: 'User not found' }, 404);
  const body = await c.req.json().catch(() => ({})) as { status?: string };
  if (body.status !== 'active' && body.status !== 'disabled') {
    return c.json({ error: "status must be 'active' or 'disabled'" }, 400);
  }

  try {
    // Deshabilitar cierra todas las sesiones vivas del usuario (multi-
    // dispositivo desde 053): sin esto, los tokens ya emitidos seguirían
    // válidos y el bloqueo sería cosmético.
    const res = await db.query(
      body.status === 'disabled'
        ? `WITH closed AS (
             DELETE FROM user_sessions WHERE user_id = $1 RETURNING 1
           )
           UPDATE users SET status = $2, updated_at = NOW()
            WHERE id = $1
            RETURNING id, status, (SELECT COUNT(*)::int FROM closed) AS closed_sessions`
        : `UPDATE users SET status = $2, updated_at = NOW() WHERE id = $1 RETURNING id, status`,
      [id, body.status]
    );
    if (res.rowCount === 0) return c.json({ error: 'User not found' }, 404);
    return c.json({ ok: true, user: res.rows[0] });
  } catch (err) {
    captureRouteError(err, 'admin] error');
    logger.error({ err }, '[admin] error');
    return c.json({ error: 'Database error' }, 500);
  }
});

adminRouter.delete('/users/:id', async (c) => {
  const id = c.req.param('id');
  // Un id no-UUID haría fallar el cast a uuid de Postgres → 409 engañoso (#321).
  if (!isUuid(id)) return c.json({ error: 'User not found' }, 404);
  try {
    const res = await db.query(`DELETE FROM users WHERE id = $1 RETURNING id`, [id]);
    if (res.rowCount === 0) return c.json({ error: 'User not found' }, 404);
    return c.json({ ok: true, deleted: id });
  } catch (err) {
    logger.error({ err }, '[admin] delete user error');
    return c.json({
      error: 'Cannot delete user (may have payment orders). Disable it instead.',
    }, 409);
  }
});

// ── Equipos: nombre de presentación curado (F3-2) ──────────────────────────

interface AdminTeamRow {
  id: string;
  name: string;
  display_name: string | null;
  short_name: string | null;
  gender: string | null;
  age_category: string | null;
  squad_level: number | null;
  team_type: string;
  club_name: string | null;
}

const MAX_DISPLAY_NAME = 120;
const MAX_TEAM_QUERY = 80;

/** Caracteres de control (C0 y DEL): no pintan nada y ensucian títulos/logs. */
function hasControlChars(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/** GET /admin/teams?q= — busca equipos para curar su nombre visible. */
adminRouter.get('/teams', async (c) => {
  const q = (c.req.query('q') ?? '').trim();
  if (q.length > MAX_TEAM_QUERY) {
    return c.json({ error: `q must be at most ${MAX_TEAM_QUERY} characters` }, 400);
  }

  try {
    const result = await db.query<AdminTeamRow>(`
      SELECT t.id, t.name, t.display_name, t.short_name, t.gender, t.age_category,
             t.squad_level, t.team_type, cl.canonical_name AS club_name
        FROM teams t
        LEFT JOIN clubs cl ON cl.id = t.club_id
       WHERE $1 = ''
          OR t.name ILIKE '%' || $1 || '%'
          OR COALESCE(t.display_name, '') ILIKE '%' || $1 || '%'
       ORDER BY COALESCE(t.display_name, t.name) ASC
       LIMIT 100
    `, [q]);

    return c.json({
      count: result.rows.length,
      teams: result.rows.map((r) => ({
        id: r.id,
        name: r.name,
        displayName: r.display_name,
        shortName: r.short_name,
        gender: r.gender,
        ageCategory: r.age_category,
        squadLevel: r.squad_level,
        teamType: r.team_type,
        clubName: r.club_name,
      })),
    });
  } catch (err) {
    captureRouteError(err, 'admin] teams list error');
    logger.error({ err }, '[admin] teams list error');
    return c.json({ error: 'Database error' }, 500);
  }
});

/**
 * PATCH /admin/teams/:id/display-name  { displayName: string | null }
 * `null` o cadena vacía restauran el nombre de la fuente.
 */
adminRouter.patch('/teams/:id/display-name', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'Team not found' }, 404);

  const body = await c.req.json().catch(() => ({})) as { displayName?: unknown } | null;
  if (!body || typeof body !== 'object' || !Object.hasOwn(body, 'displayName')) {
    return c.json({ error: 'displayName is required' }, 400);
  }
  if (body.displayName !== null && typeof body.displayName !== 'string') {
    return c.json({ error: 'displayName must be a string or null' }, 400);
  }

  const displayName = body.displayName === null
    ? null
    : body.displayName.replace(/\s+/g, ' ').trim();

  if (displayName !== null && displayName.length > MAX_DISPLAY_NAME) {
    return c.json({ error: `displayName must be at most ${MAX_DISPLAY_NAME} characters` }, 400);
  }
  if (displayName && hasControlChars(displayName)) {
    return c.json({ error: 'displayName contains control characters' }, 400);
  }

  try {
    const result = await db.query<{ id: string; name: string; display_name: string | null }>(
      `UPDATE teams
          SET display_name = $2,
              updated_at  = NOW()
        WHERE id = $1
        RETURNING id, name, display_name`,
      [id, displayName || null]
    );
    if (result.rowCount === 0) return c.json({ error: 'Team not found' }, 404);
    const row = result.rows[0]!;
    return c.json({
      ok: true,
      team: { id: row.id, name: row.name, displayName: row.display_name },
    });
  } catch (err) {
    captureRouteError(err, 'admin] team display name error');
    logger.error({ err }, '[admin] team display name error');
    return c.json({ error: 'Database error' }, 500);
  }
});

// ── Competiciones ─────────────────────

/**
 * GET /admin/competitions/archived
 * Lista todas las competiciones archivadas con su ultima actividad conocida.
 */
adminRouter.get('/competitions/archived', async (c) => {
  try {
    const archived = await listArchivedCompetitions();
    return c.json({ count: archived.length, competitions: archived });
  } catch (err) {
    captureRouteError(err, 'admin] error');
    logger.error({ err }, '[admin] error');
    return c.json({ error: 'Database error' }, 500);
  }
});

/**
 * GET /admin/competitions/duplicates?threshold=0.6
 * Detecta pares de competiciones activas con nombres similares (pg_trgm).
 * threshold: 0-1, por defecto 0.6.
 */
adminRouter.get('/competitions/duplicates', async (c) => {
  const threshold = Math.min(1, Math.max(0, parseFloat(c.req.query('threshold') ?? '0.6')));
  try {
    const candidates = await findDuplicateCandidates(threshold);
    return c.json({
      threshold,
      count: candidates.length,
      message: candidates.length === 0
        ? 'No se detectaron competiciones similares con este umbral.'
        : `${candidates.length} pares detectados. Revisa antes de fusionar.`,
      duplicates: candidates,
    });
  } catch (err) {
    captureRouteError(err, 'admin] error');
    logger.error({ err }, '[admin] error');
    return c.json({ error: 'Database error' }, 500);
  }
});

/**
 * POST /admin/competitions/:id/archive
 * Archiva manualmente una competicion activa.
 */
adminRouter.post('/competitions/:id/archive', async (c) => {
  const id = c.req.param('id');
  // Un id no-UUID haría fallar el cast a uuid de Postgres → 500 (#321).
  if (!isUuid(id)) return c.json({ error: 'Competition not found' }, 404);
  try {
    const comp = await archiveCompetition(id);
    if (!comp) return c.json({ error: 'Competition not found' }, 404);
    return c.json({ ok: true, competition: { id: comp.id, name: comp.name, archived_at: comp.archived_at } });
  } catch (err) {
    captureRouteError(err, 'admin] error');
    logger.error({ err }, '[admin] error');
    return c.json({ error: 'Database error' }, 500);
  }
});

/**
 * POST /admin/competitions/:id/restore
 * Reactiva manualmente una competicion archivada.
 */
adminRouter.post('/competitions/:id/restore', async (c) => {
  const id = c.req.param('id');
  // Un id no-UUID haría fallar el cast a uuid de Postgres → 500 (#321).
  if (!isUuid(id)) return c.json({ error: 'Competition not found' }, 404);
  try {
    const comp = await restoreCompetition(id);
    if (!comp) return c.json({ error: 'Competition not found' }, 404);
    return c.json({ ok: true, competition: { id: comp.id, name: comp.name, archived_at: comp.archived_at } });
  } catch (err) {
    captureRouteError(err, 'admin] error');
    logger.error({ err }, '[admin] error');
    return c.json({ error: 'Database error' }, 500);
  }
});

/**
 * POST /admin/competitions/merge
 * Fusiona dos competiciones: mueve las temporadas de mergeId a keepId
 * y elimina el duplicado.
 *
 * Body: { keepId: string, mergeId: string }
 *
 * DESTRUCTIVA: elimina la competicion mergeId.
 * Confirmar con GET /duplicates antes de ejecutar.
 */
adminRouter.post('/competitions/merge', async (c) => {
  const body = await c.req.json().catch(() => ({})) as { keepId?: string; mergeId?: string };
  if (!body.keepId || !body.mergeId) {
    return c.json({ error: 'Body must contain keepId and mergeId (UUIDs)' }, 400);
  }
  // Un id no-UUID haría fallar el cast a uuid de Postgres → 500 (#321).
  if (!isUuid(body.keepId) || !isUuid(body.mergeId)) {
    return c.json({ error: 'keepId and mergeId must be UUIDs' }, 400);
  }
  if (body.keepId === body.mergeId) {
    return c.json({ error: 'keepId and mergeId must be different' }, 400);
  }
  try {
    const result = await mergeCompetitions(body.keepId, body.mergeId);
    return c.json({ ok: true, ...result });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return c.json({ error: 'Merge failed', detail }, detail.includes('no existen') ? 404 : 500);
  }
});

// ── Calidad de datos / visibilidad (migración 067) ───────────────────────────

function parseQuality(raw: unknown): DataQuality | null {
  return raw === 'ok' || raw === 'en_revision' ? raw : null;
}

/** GET /admin/competitions/quality — todas (incl. archivadas/ocultas) con recuento de temporadas. */
adminRouter.get('/competitions/quality', async (c) => {
  try {
    const competitions = await listCompetitionsForQuality();
    return c.json({ count: competitions.length, competitions });
  } catch (err) {
    captureRouteError(err, 'admin] competitions/quality error');
    logger.error({ err }, '[admin] competitions/quality error');
    return c.json({ error: 'Database error' }, 500);
  }
});

/** GET /admin/competitions/:id/seasons/quality — todas las temporadas (incl. ocultas). */
adminRouter.get('/competitions/:id/seasons/quality', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'Competition not found' }, 404);
  try {
    const seasons = await listSeasonsForQuality(id);
    return c.json({ count: seasons.length, seasons });
  } catch (err) {
    captureRouteError(err, 'admin] seasons/quality error');
    logger.error({ err }, '[admin] seasons/quality error');
    return c.json({ error: 'Database error' }, 500);
  }
});

/** PATCH /admin/competitions/:id/quality — Body: { dataQuality: 'ok' | 'en_revision' } */
adminRouter.patch('/competitions/:id/quality', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'Competition not found' }, 404);
  const body = await c.req.json().catch(() => ({})) as { dataQuality?: unknown };
  const quality = parseQuality(body.dataQuality);
  if (!quality) return c.json({ error: "dataQuality must be 'ok' or 'en_revision'" }, 400);
  try {
    const comp = await setCompetitionQuality(id, quality);
    if (!comp) return c.json({ error: 'Competition not found' }, 404);
    return c.json({ ok: true, competition: { id: comp.id, name: comp.name, dataQuality: comp.data_quality } });
  } catch (err) {
    captureRouteError(err, 'admin] set competition quality error');
    logger.error({ err }, '[admin] set competition quality error');
    return c.json({ error: 'Database error' }, 500);
  }
});

/** PATCH /admin/seasons/:id/quality — Body: { dataQuality: 'ok' | 'en_revision' } */
adminRouter.patch('/seasons/:id/quality', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'Season not found' }, 404);
  const body = await c.req.json().catch(() => ({})) as { dataQuality?: unknown };
  const quality = parseQuality(body.dataQuality);
  if (!quality) return c.json({ error: "dataQuality must be 'ok' or 'en_revision'" }, 400);
  try {
    const season = await setSeasonQuality(id, quality);
    if (!season) return c.json({ error: 'Season not found' }, 404);
    return c.json({ ok: true, season: { id: season.id, name: season.name, dataQuality: season.data_quality } });
  } catch (err) {
    captureRouteError(err, 'admin] set season quality error');
    logger.error({ err }, '[admin] set season quality error');
    return c.json({ error: 'Database error' }, 500);
  }
});

// ── Resolución de entidades (cola HITL, Fase 2b) ──────────────────

/**
 * GET /admin/resolution-queue?status=pending&limit=100
 * Bandeja del panel: ítems no resueltos, ordenados por impacto (occurrences).
 */
adminRouter.get('/resolution-queue', async (c) => {
  const status = c.req.query('status') ?? 'pending';
  const limit = Math.min(500, Math.max(1, parseInt(c.req.query('limit') ?? '100', 10) || 100));
  try {
    const raw = await listResolutionQueue(status, limit);
    // Cada ítem dice qué se pregunta: un nombre de la fuente sin equipo
    // ("¿qué equipo es X?") o un par de equipos parecidos ("¿son el mismo?").
    // Los candidatos llevan su ficha (escudo, sección, última temporada) para
    // decidir sin abrir cada equipo.
    const ids = [...new Set(raw.flatMap((i) => (i.candidates ?? []).map((cnd) => cnd.teamId)))]
      .filter((x) => isUuid(x));
    const teams = await describeTeams(ids);
    const items = raw.map((i) => ({
      ...i,
      kind: (i.context as { kind?: string } | null)?.kind === 'team-duplicate' ? 'duplicate' : 'name',
    }));
    return c.json({ status, count: items.length, items, teams });
  } catch (err) {
    captureRouteError(err, 'admin] resolution-queue error');
    logger.error({ err }, '[admin] resolution-queue error');
    return c.json({ error: 'Database error' }, 500);
  }
});

/**
 * GET /admin/resolution-queue/stats
 * Salud del embudo: backlog de la cola y aprendizaje (aliases por origen).
 */
adminRouter.get('/resolution-queue/stats', async (c) => {
  try {
    return c.json(await getResolutionStats());
  } catch (err) {
    captureRouteError(err, 'admin] resolution-queue stats error');
    logger.error({ err }, '[admin] resolution-queue stats error');
    return c.json({ error: 'Database error' }, 500);
  }
});

/**
 * POST /admin/resolution-queue/:id/resolve  Body: { teamId }
 * Asigna el ref al team elegido, marca resuelto y APRENDE (escribe el alias),
 * así el mismo nombre se resuelve solo la próxima vez.
 */
adminRouter.post('/resolution-queue/:id/resolve', async (c) => {
  const id = c.req.param('id');
  // Un id no-UUID haría fallar el cast a uuid de Postgres → 500 (#321).
  if (!isUuid(id)) return c.json({ error: 'Item not found or not pending' }, 404);
  const body = await c.req.json().catch(() => ({})) as { teamId?: string };
  if (!body.teamId) return c.json({ error: 'Body must contain teamId' }, 400);
  if (!isUuid(body.teamId)) return c.json({ error: 'teamId must be a UUID' }, 400);
  try {
    const result = await resolveQueueItem(id, body.teamId, 'human:admin');
    if (!result) return c.json({ error: 'Item not found or not pending' }, 404);
    return c.json({ ok: true, ...result });
  } catch (err) {
    captureRouteError(err, 'admin] resolve error');
    logger.error({ err }, '[admin] resolve error');
    return c.json({ error: 'Database error' }, 500);
  }
});

/**
 * POST /admin/resolution-queue/:id/reject
 * Descarta el ítem (ruido, no es un club real). No crea alias.
 */
adminRouter.post('/resolution-queue/:id/reject', async (c) => {
  const id = c.req.param('id');
  // Un id no-UUID haría fallar el cast a uuid de Postgres → 500 (#321).
  if (!isUuid(id)) return c.json({ error: 'Item not found or not pending' }, 404);
  try {
    const ok = await rejectQueueItem(id);
    if (!ok) return c.json({ error: 'Item not found or not pending' }, 404);
    return c.json({ ok: true, rejected: id });
  } catch (err) {
    captureRouteError(err, 'admin] reject error');
    logger.error({ err }, '[admin] reject error');
    return c.json({ error: 'Database error' }, 500);
  }
});

// ── A4: clubes por escudo (revisión antes del backfill) ─────────────────────

/** GET /admin/club-crests?issues=1 — equipos agrupados por escudo, con su club. Solo lectura. */
adminRouter.get('/club-crests', async (c) => {
  try {
    const groups = await listCrestReviewGroups({ onlyIssues: c.req.query('issues') === '1' });
    const counts = { merge: 0, pending: 0, ok: 0 };
    for (const g of groups) counts[g.status]++;
    return c.json({ count: groups.length, counts, groups });
  } catch (err) {
    captureRouteError(err, 'admin] club-crests error');
    return c.json({ error: 'Database error' }, 500);
  }
});

// ── B1: crosswalk de jugadores entre portales ────────────────────────────────

/** GET /admin/player-links?status=pending — candidatos a misma persona. */
adminRouter.get('/player-links', async (c) => {
  const status = c.req.query('status') ?? 'pending';
  try {
    const items = await listPlayerLinkCandidates(status);
    return c.json({ status, count: items.length, items });
  } catch (err) {
    captureRouteError(err, 'admin] player-links error');
    return c.json({ error: 'Database error' }, 500);
  }
});

/** POST /admin/player-links/generate — propone candidatos nuevos (nunca enlaza). */
adminRouter.post('/player-links/generate', async (c) => {
  try {
    return c.json({ created: await generatePlayerLinkCandidates() });
  } catch (err) {
    captureRouteError(err, 'admin] player-links generate error');
    return c.json({ error: 'Database error' }, 500);
  }
});

/** POST /admin/player-links/:id/accept — enlaza las dos fichas (redirección 308 de la absorbida). */
adminRouter.post('/player-links/:id/accept', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'Candidate not found or not pending' }, 404);
  try {
    const r = await acceptPlayerLinkCandidate(id, 'human:admin');
    if (!r) return c.json({ error: 'Candidate not found or not pending' }, 404);
    return c.json({ ok: true, ...r });
  } catch (err) {
    if (err instanceof Error && /prohibid/i.test(err.message)) return c.json({ error: err.message }, 409);
    captureRouteError(err, 'admin] player-links accept error');
    return c.json({ error: 'Database error' }, 500);
  }
});

/** POST /admin/player-links/:id/reject — descarta y prohíbe el par para que no vuelva. */
adminRouter.post('/player-links/:id/reject', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'Candidate not found or not pending' }, 404);
  try {
    if (!(await rejectPlayerLinkCandidate(id))) return c.json({ error: 'Candidate not found or not pending' }, 404);
    return c.json({ ok: true });
  } catch (err) {
    captureRouteError(err, 'admin] player-links reject error');
    return c.json({ error: 'Database error' }, 500);
  }
});

// ── B2: zonas de clasificación (reglamento como datos) ───────────────────────

const ZONE_KINDS = new Set(['champion', 'promotion', 'promotion_playoff', 'final_phase', 'placement', 'playout', 'relegation']);

/** Valida una zona del body; devuelve null si está mal formada. */
function parseZone(z: unknown): StandingsZone | null {
  if (!z || typeof z !== 'object') return null;
  const o = z as Record<string, unknown>;
  const posFrom = Number(o['posFrom']);
  const posTo = Number(o['posTo']);
  if (typeof o['kind'] !== 'string' || !ZONE_KINDS.has(o['kind'])) return null;
  if (!Number.isInteger(posFrom) || !Number.isInteger(posTo) || posFrom < 1 || posTo < posFrom) return null;
  const phaseId = o['phaseId'] == null ? null : String(o['phaseId']);
  if (phaseId && !isUuid(phaseId)) return null;
  return {
    kind: o['kind'] as StandingsZone['kind'],
    posFrom, posTo,
    target: o['target'] == null ? null : String(o['target']),
    phaseId,
    groupName: o['groupName'] == null ? null : String(o['groupName']),
  };
}

/** GET /admin/seasons/:id/zones */
adminRouter.get('/seasons/:id/zones', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'Season not found' }, 404);
  try {
    return c.json({ seasonId: id, zones: await getStandingsZones(id) });
  } catch (err) {
    captureRouteError(err, 'admin] zones get error');
    return c.json({ error: 'Database error' }, 500);
  }
});

/** PUT /admin/seasons/:id/zones  Body: { sourceNote, zones: StandingsZone[] } — reemplaza todas. */
adminRouter.put('/seasons/:id/zones', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'Season not found' }, 404);
  const body = await c.req.json().catch(() => ({})) as { sourceNote?: unknown; zones?: unknown };
  if (typeof body.sourceNote !== 'string' || !body.sourceNote.trim()) {
    return c.json({ error: 'sourceNote (fuente normativa) es obligatoria' }, 400);
  }
  if (!Array.isArray(body.zones)) return c.json({ error: 'zones debe ser un array' }, 400);
  const zones = body.zones.map(parseZone);
  if (zones.some((z) => z === null)) return c.json({ error: 'Zona mal formada' }, 400);
  try {
    await replaceStandingsZones(id, zones as StandingsZone[], body.sourceNote);
    return c.json({ ok: true, count: zones.length });
  } catch (err) {
    captureRouteError(err, 'admin] zones put error');
    return c.json({ error: 'Database error' }, 500);
  }
});

/** POST /admin/seasons/:id/zones/copy-from/:fromId — punto de partida desde otra temporada. */
adminRouter.post('/seasons/:id/zones/copy-from/:fromId', async (c) => {
  const id = c.req.param('id');
  const fromId = c.req.param('fromId');
  if (!isUuid(id) || !isUuid(fromId)) return c.json({ error: 'Season not found' }, 404);
  try {
    return c.json({ ok: true, copied: await copyStandingsZones(fromId, id) });
  } catch (err) {
    captureRouteError(err, 'admin] zones copy error');
    return c.json({ error: 'Database error' }, 500);
  }
});
