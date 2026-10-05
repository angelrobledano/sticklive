import { Hono } from 'hono';
import { randomBytes, createHash } from 'node:crypto';
import { db, withTransaction } from '@sports/db';
import { logger } from '@sports/logger';
import { rateLimit, rateLimitBy } from '../lib/rate-limit.js';
import { captureRouteError } from '../lib/route-error.js';
import { buildFavoritePairs } from '../lib/favorites.js';
import { signState, verifyState } from '../lib/auth-state.js';
import { postgresNonceStore } from '../lib/oauth-nonce-pg.js';

export const authRouter = new Hono();

const MAGIC_LINK_TTL_MIN = 15;
const SESSION_TTL_DAYS = 90;
// Tope de sesiones simultáneas por usuario (PC + móvil + tablet con margen).
// Al crear la 6ª se expulsa la más antigua: acota el daño de un token filtrado
// sin expulsar dispositivos reales (decisión de producto 26/09/2026).
const MAX_SESSIONS_PER_USER = 5;
const WEB_BASE = process.env['WEB_BASE_URL'] ?? 'http://localhost:3001';

// Enlaces de login en la respuesta: SOLO en desarrollo y con opt-in EXPLÍCITO.
// Nunca en producción, aunque falte SMTP (en ese caso → 503), para que un
// despliegue sin SMTP no filtre accesos válidos (auditoría S2).
const DEV_LINKS =
  process.env['AUTH_DEV_LINKS'] === '1' && process.env['NODE_ENV'] !== 'production';

// ── Tokens: se generan en claro (van al cliente) y se guardan HASHEADOS ─────────
function newToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

async function userFromBearer(authHeader: string | undefined) {
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  if (!token) return null;
  const res = await db.query<{ id: string; email: string | null; session_id: string }>(
    `SELECT u.id, u.email, s.id AS session_id
       FROM user_sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1
        AND s.expires_at > NOW()
        AND u.status = 'active'`,
    [hashToken(token)]
  );
  const user = res.rows[0];
  if (!user) return null;

  // Caducidad renovable (sliding): cada uso empuja expires_at a +90 días.
  // El WHERE acota la escritura a una vez al día por sesión como mucho: con
  // más de TTL-1 días por delante no hay nada que renovar.
  await db.query(
    `UPDATE user_sessions
        SET expires_at = NOW() + make_interval(days => $2::int),
            last_used_at = NOW()
      WHERE id = $1
        AND expires_at < NOW() + make_interval(days => ($2::int - 1))`,
    [user.session_id, SESSION_TTL_DAYS]
  );

  return { id: user.id, email: user.email };
}

async function openSession(userId: string): Promise<string> {
  const session = newToken();
  await withTransaction(async (tx) => {
    // Higiene local: las caducadas de este usuario fuera.
    await tx.query(
      `DELETE FROM user_sessions WHERE user_id = $1 AND expires_at < NOW()`,
      [userId]
    );
    await tx.query(
      `INSERT INTO user_sessions (user_id, token_hash, expires_at)
       VALUES ($1, $2, NOW() + make_interval(days => $3::int))`,
      [userId, hashToken(session), SESSION_TTL_DAYS]
    );
    // Multi-dispositivo: la sesión nueva NO invalida las anteriores. Solo se
    // recorta al tope expulsando las más antiguas.
    await tx.query(
      `DELETE FROM user_sessions
        WHERE user_id = $1
          AND id NOT IN (
            SELECT id FROM user_sessions
             WHERE user_id = $1
             ORDER BY created_at DESC, id DESC
             LIMIT $2
          )`,
      [userId, MAX_SESSIONS_PER_USER]
    );
  });
  return session; // en claro, solo para el cliente
}

/**
 * POST /auth/magic-link  { email }
 * Genera un enlace de acceso de un solo uso (15 min). Rate limit estricto.
 */
authRouter.post(
  '/magic-link',
  rateLimit(5, 60 * 60_000),
  // #307: además por email, para que rotar IPs no permita bombardear a una
  // víctima con correos (harassment / reputación SMTP).
  rateLimitBy(5, 60 * 60_000, async (c) => {
    const body = await c.req.json<{ email?: string }>().catch((): { email?: string } => ({}));
    return (body.email ?? '').trim().toLowerCase() || 'noemail';
  }),
  async (c) => {
    try {
      const { email } = await c.req.json<{ email?: string }>();
      const clean = (email ?? '').trim().toLowerCase();
      if (clean.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean)) {
        return c.json({ error: 'invalid_email', message: 'Ese email no parece válido — revísalo y probamos de nuevo.' }, 400);
      }

      const token = newToken();
      await db.query(
        `INSERT INTO auth_tokens (token, email, expires_at)
         VALUES ($1, $2, NOW() + make_interval(mins => $3::int))`,
        [hashToken(token), clean, MAGIC_LINK_TTL_MIN]
      );
      const link = `${WEB_BASE}/login?token=${token}`;

      const { magicLinkDelivery, sendMagicLink } = await import('../lib/mailer.js');
      const delivery = magicLinkDelivery(process.env['SMTP_HOST'], DEV_LINKS);
      if (delivery === 'dev-link') {
        logger.info({ email: clean }, '[auth] (DEV) magic link generado');
        return c.json({ sent: true, devLink: link });
      }
      if (delivery === 'unconfigured') {
        // Producción sin SMTP: NO filtrar el enlace jamás.
        logger.error('[auth] SMTP_HOST no configurado: no se puede enviar el magic link');
        return c.json({ error: 'email_not_configured' }, 503);
      }

      await sendMagicLink(clean, link);
      return c.json({ sent: true });
    } catch (err) {
      captureRouteError(err, 'auth] magic-link error');
      logger.error({ err }, '[auth] magic-link error');
      return c.json({ error: 'server_error' }, 500);
    }
  }
);

/**
 * POST /auth/verify  { token, deviceId? }
 * Canjea el magic link: crea/asocia el usuario y abre sesión.
 */
authRouter.post('/verify', rateLimit(20, 10 * 60_000), async (c) => {
  try {
    const { token, deviceId } = await c.req.json<{ token?: string; deviceId?: string }>();
    if (!token) return c.json({ error: 'missing_token' }, 400);

    const tokenRes = await db.query<{ id: string; email: string }>(
      `UPDATE auth_tokens SET used_at = NOW()
       WHERE token = $1 AND used_at IS NULL AND expires_at > NOW()
       RETURNING id, email`,
      [hashToken(token)]
    );
    if (tokenRes.rows.length === 0) {
      return c.json({
        error: 'expired',
        message: 'Vaya, el enlace ha caducado. No te preocupes, introduce tu email de nuevo y te enviamos uno fresquito al instante.',
      }, 410);
    }
    const email = tokenRes.rows[0]!.email;

    const userId = await resolveUserByEmail(email, deviceId);
    if (userId === 'disabled') return c.json({ error: 'account_disabled' }, 403);

    const session = await openSession(userId);
    return c.json({ session, email });
  } catch (err) {
    captureRouteError(err, 'auth] verify error');
    logger.error({ err }, '[auth] verify error');
    return c.json({ error: 'server_error' }, 500);
  }
});

/**
 * POST /auth/exchange  { code }
 * Canjea el código de login de la app móvil (Task 3.1) por una sesión Bearer.
 * El código lo entrega el callback de Google por el scheme sticklive:// y
 * caduca en 2 minutos. Canje atómico single-use: el UPDATE solo toca la fila si
 * no está usada ni caducada, así el 2º canje del mismo código no devuelve
 * filas → 400. Mismo patrón (hash + single-use) que /auth/verify.
 */
authRouter.post('/exchange', rateLimit(10, 10 * 60_000), async (c) => {
  try {
    const { code } = await c.req.json<{ code?: string }>().catch((): { code?: string } => ({}));
    if (!code || code.length > 512) return c.json({ error: 'invalid_code' }, 400);

    const codeHash = hashToken(code);
    const userId = await withTransaction(async (tx) => {
      // Higiene de caducados: purga de códigos expirados hace más de 1 día,
      // en la misma transacción y sin cron. El volumen de canjes está acotado
      // por el rate limit y cada código vive 2 min, así que basta con esto para
      // que la tabla no crezca sin techo (índice expires_at → barato).
      await tx.query(
        `DELETE FROM app_login_codes WHERE expires_at < NOW() - INTERVAL '1 day'`
      );
      const res = await tx.query<{ user_id: string }>(
        `UPDATE app_login_codes SET used_at = NOW()
          WHERE code_hash = $1 AND used_at IS NULL AND expires_at > NOW()
          RETURNING user_id`,
        [codeHash]
      );
      return res.rows[0]?.user_id ?? null;
    });
    if (!userId) return c.json({ error: 'invalid_code' }, 400);

    const session = await openSession(userId);
    const u = await db.query<{ email: string | null }>(
      `SELECT email FROM users WHERE id = $1`, [userId]
    );
    return c.json({ session, email: u.rows[0]?.email ?? null });
  } catch (err) {
    captureRouteError(err, 'auth] exchange error');
    logger.error({ err }, '[auth] exchange error');
    return c.json({ error: 'server_error' }, 500);
  }
});

/**
 * Busca/crea el usuario por email, adoptando el usuario anónimo del dispositivo
 * si procede. Devuelve el id, o 'disabled' si la cuenta está deshabilitada.
 */
async function resolveUserByEmail(email: string, deviceId?: string): Promise<string> {
  const found = await db.query<{ id: string; status?: string }>(
    `SELECT id, status FROM users WHERE LOWER(email) = $1`, [email]
  );
  if (found.rows[0]?.status === 'disabled') return 'disabled';
  let userId = found.rows[0]?.id;

  if (!userId && deviceId) {
    // #161: NO adoptar la identidad anónima si tiene premium ACTIVO. El deviceId
    // vive en el localStorage del navegador (y es el distinctId de PostHog), así
    // que quien lo conozca podría reclamar un premium comprado por ese device.
    // Un premium ya caducado no tiene entitlement que proteger y sí se adopta.
    const adopted = await db.query<{ id: string }>(
      `UPDATE users SET email = $2, updated_at = NOW()
       WHERE device_id = $1 AND email IS NULL
         AND (premium_until IS NULL OR premium_until <= NOW())
       RETURNING id`,
      [deviceId, email]
    );
    userId = adopted.rows[0]?.id;
  }
  if (!userId) {
    // users.device_id tiene UNIQUE: si el device del cliente ya pertenece a otra
    // cuenta (con otro email), un INSERT directo reventaría con 500. Probamos con
    // el device_id del cliente y, si choca, usamos uno único derivado del email
    // (los emails son únicos por uq_users_email, así que no puede colisionar).
    const created = await db.query<{ id: string }>(
      `INSERT INTO users (device_id, email) VALUES ($1, $2)
       ON CONFLICT (device_id) DO NOTHING RETURNING id`,
      [deviceId || `email:${email}`, email]
    );
    userId = created.rows[0]?.id;
    if (!userId) {
      const fallback = await db.query<{ id: string }>(
        `INSERT INTO users (device_id, email) VALUES ($1, $2) RETURNING id`,
        [`email:${email}`, email]
      );
      userId = fallback.rows[0]!.id;
    }
  }
  return userId;
}

// ── Google OAuth ──────────────────────────────────────────────────────────────

const GOOGLE_AUTH_URL  = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API_PUBLIC = process.env['API_BASE_URL'] ?? 'http://localhost:3000';

authRouter.get('/google', (c) => {
  const clientId = process.env['GOOGLE_CLIENT_ID'];
  if (!clientId) return c.json({ error: 'google_not_configured' }, 503);

  // deviceId: la web manda `device_id` (histórico); la app manda `device`
  // (Task 3.2). Ambos acaban en el state como `d`.
  const deviceId = c.req.query('device_id') ?? c.req.query('device') ?? '';
  // client=app (valor EXACTO): el flujo viene de la app móvil y el callback
  // emitirá un código de canje en vez de abrir sesión web.
  const isAppClient = c.req.query('client') === 'app';
  // State FIRMADO (HMAC): el callback lo verifica → no se acepta un state ajeno.
  const state = signState({
    d: deviceId,
    n: randomBytes(8).toString('hex'),
    ...(isAppClient ? { client: 'app' as const } : {}),
  });

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${API_PUBLIC}/auth/google/callback`,
    response_type: 'code',
    scope: 'openid email',
    state,
    prompt: 'select_account',
  });
  return c.redirect(`${GOOGLE_AUTH_URL}?${params}`);
});

authRouter.get('/google/callback', async (c) => {
  const clientId = process.env['GOOGLE_CLIENT_ID'];
  const clientSecret = process.env['GOOGLE_CLIENT_SECRET'];
  // Log de cada motivo de fallo para diagnóstico (el cliente solo ve el motivo).
  const fail = (reason: string) => {
    logger.error({ reason }, '[auth] google login failed');
    return c.redirect(`${WEB_BASE}/login#error=${reason}`);
  };

  try {
    if (!clientId || !clientSecret) return fail('google_not_configured');
    const code = c.req.query('code');
    if (!code) return fail('google_denied');

    // Verificar el state firmado y su TTL (CSRF). Si no valida, abortar.
    const st = verifyState(c.req.query('state'));
    if (!st || !st.n) return fail('bad_state');
    // Single-use (#306): el nonce se consume una sola vez. Reutilizar un state
    // (aunque siga vigente) se rechaza. Fallo de BD → fail-closed.
    const fresh = await postgresNonceStore.consume(st.n, new Date((st.exp ?? 0) * 1000));
    if (!fresh) return fail('state_reused');
    const deviceId = typeof st.d === 'string' ? st.d : '';

    const redirectUri = `${API_PUBLIC}/auth/google/callback`;
    // Canjear el code por tokens (server-to-server, por TLS con Google)
    const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    if (!tokenRes.ok) {
      // El cuerpo de Google revela la causa exacta: invalid_client,
      // redirect_uri_mismatch, invalid_grant, etc. Logueamos el redirect_uri
      // que enviamos para detectar desajustes de configuración (API_BASE_URL).
      const detail = await tokenRes.text().catch(() => '');
      logger.error({ status: tokenRes.status, redirectUri, detail }, '[auth] google token exchange');
      return fail('google_token');
    }
    const tokens = await tokenRes.json() as { id_token?: string };
    if (!tokens.id_token) return fail('google_token');

    // El id_token viene directo del token endpoint de Google por TLS; validamos
    // audiencia y verificación de email (guía de Google permite no re-verificar
    // la firma cuando el token se obtiene así).
    const payload = JSON.parse(
      Buffer.from(tokens.id_token.split('.')[1] ?? '', 'base64url').toString()
    ) as { aud?: string; email?: string; email_verified?: boolean };
    if (payload.aud !== clientId || !payload.email || payload.email_verified !== true) {
      return fail('google_email');
    }
    const email = payload.email.toLowerCase();

    const userId = await resolveUserByEmail(email, deviceId);
    if (userId === 'disabled') return fail('account_disabled');

    // Login desde la APP (Task 3.1): la sesión NUNCA viaja por el custom scheme
    // sticklive:// (otra app del dispositivo podría interceptarlo). Se emite un
    // código single-use (2 min) que la app canjea por Bearer vía POST /auth/exchange.
    // Se guarda el HASH (patrón auth_tokens); el claro solo va en la redirect URL.
    if (st.client === 'app') {
      const appCode = newToken(24);
      await db.query(
        `INSERT INTO app_login_codes (code_hash, user_id, expires_at)
         VALUES ($1, $2, NOW() + make_interval(secs => 120))`,
        [hashToken(appCode), userId]
      );
      return c.redirect(
        `sticklive://auth/callback?code=${encodeURIComponent(appCode)}&email=${encodeURIComponent(email)}`
      );
    }

    // Flujo web existente, intacto:
    const session = await openSession(userId);
    return c.redirect(
      `${WEB_BASE}/login#session=${encodeURIComponent(session)}&email=${encodeURIComponent(email)}`
    );
  } catch (err) {
    logger.error({ err }, '[auth] google callback error');
    return fail('google_error');
  }
});

/** GET /auth/me — sesión actual */
authRouter.get('/me', async (c) => {
  const user = await userFromBearer(c.req.header('Authorization'));
  if (!user) return c.json({ authenticated: false }, 401);
  return c.json({ authenticated: true, email: user.email });
});

/**
 * GET /auth/favorites — favoritos de la cuenta.
 *
 * Fuente de verdad multi-dispositivo (#268): en las sincronizaciones posteriores
 * al primer login el cliente lee aquí (sin fusionar) para no reinsertar lo que
 * otro dispositivo dejó de seguir.
 */
authRouter.get('/favorites', async (c) => {
  const user = await userFromBearer(c.req.header('Authorization'));
  if (!user) return c.json({ error: 'unauthorized' }, 401);
  try {
    const all = await db.query<{ kind: string; ref_id: string }>(
      `SELECT kind, ref_id FROM user_favorites WHERE user_id = $1`, [user.id]
    );
    return c.json({
      teams:   all.rows.filter((r) => r.kind === 'team').map((r) => r.ref_id),
      leagues: all.rows.filter((r) => r.kind === 'league').map((r) => r.ref_id),
      players: all.rows.filter((r) => r.kind === 'player').map((r) => r.ref_id),
    });
  } catch (err) {
    captureRouteError(err, 'auth] favorites read error');
    logger.error({ err }, '[auth] favorites read error');
    return c.json({ error: 'server_error' }, 500);
  }
});

/**
 * POST /auth/favorites/merge  { teams: string[], leagues: string[], players: string[] }
 * Fusiona los favoritos locales (anónimos) con los de la cuenta. Idempotente.
 */
authRouter.post('/favorites/merge', async (c) => {
  const user = await userFromBearer(c.req.header('Authorization'));
  if (!user) return c.json({ error: 'unauthorized' }, 401);

  try {
    const { teams = [], leagues = [], players = [] } =
      await c.req.json<{ teams?: string[]; leagues?: string[]; players?: string[] }>();

    // #333: un solo INSERT (unnest) por merge, dentro de una transacción, en vez
    // de hasta 600 INSERT secuenciales sin atomicidad. La lógica de validación
    // (UUID, tope por tipo) vive en lib/favorites.ts y está testeada.
    const pairs = buildFavoritePairs({ teams, leagues, players });

    const all = await withTransaction(async (tx) => {
      if (pairs.length > 0) {
        await tx.query(
          `INSERT INTO user_favorites (user_id, kind, ref_id)
           SELECT $1::uuid, u.kind, u.ref_id::uuid
           FROM unnest($2::text[], $3::text[]) AS u(kind, ref_id)
           ON CONFLICT DO NOTHING`,
          [user.id, pairs.map((p) => p.kind), pairs.map((p) => p.refId)]
        );
      }
      return tx.query<{ kind: string; ref_id: string }>(
        `SELECT kind, ref_id FROM user_favorites WHERE user_id = $1`, [user.id]
      );
    });

    return c.json({
      teams:   all.rows.filter((r) => r.kind === 'team').map((r) => r.ref_id),
      leagues: all.rows.filter((r) => r.kind === 'league').map((r) => r.ref_id),
      players: all.rows.filter((r) => r.kind === 'player').map((r) => r.ref_id),
    });
  } catch (err) {
    captureRouteError(err, 'auth] merge error');
    logger.error({ err }, '[auth] merge error');
    return c.json({ error: 'server_error' }, 500);
  }
});

/** DELETE /auth/favorites  { kind, refId } — quitar favorito en la nube */
authRouter.delete('/favorites', async (c) => {
  const user = await userFromBearer(c.req.header('Authorization'));
  if (!user) return c.json({ error: 'unauthorized' }, 401);
  const { kind, refId } = await c.req.json<{ kind?: string; refId?: string }>();
  if (!kind || !refId) return c.json({ error: 'missing_params' }, 400);
  await db.query(
    `DELETE FROM user_favorites WHERE user_id = $1 AND kind = $2 AND ref_id = $3`,
    [user.id, kind, refId]
  );
  return c.json({ ok: true });
});
