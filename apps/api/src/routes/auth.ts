import { Hono } from 'hono';
import { randomBytes, createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { db } from '@sports/db';
import { rateLimit } from '../lib/rate-limit.js';

export const authRouter = new Hono();

const MAGIC_LINK_TTL_MIN = 15;
const SESSION_TTL_DAYS = 90;
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

// ── State de OAuth firmado (HMAC) para prevenir CSRF de login (auditoría S4) ────
function stateSecret(): string {
  // Secreto solo-servidor. Si no hay uno dedicado, se usa el de Google (presente
  // siempre que OAuth está configurado).
  return process.env['AUTH_STATE_SECRET'] ?? process.env['GOOGLE_CLIENT_SECRET'] ?? '';
}
function signState(payload: object): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', stateSecret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}
function verifyState(raw: string | undefined): { d?: string } | null {
  if (!raw) return null;
  const [body, sig] = raw.split('.');
  if (!body || !sig) return null;
  const expected = createHmac('sha256', stateSecret()).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString());
  } catch {
    return null;
  }
}

async function userFromBearer(authHeader: string | undefined) {
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  if (!token) return null;
  const res = await db.query<{ id: string; email: string | null }>(
    `SELECT id, email FROM users
     WHERE session_token = $1 AND status = 'active'
       AND (session_expires_at IS NULL OR session_expires_at > NOW())`,
    [hashToken(token)]
  );
  return res.rows[0] ?? null;
}

async function openSession(userId: string): Promise<string> {
  const session = newToken();
  await db.query(
    `UPDATE users
        SET session_token = $2,
            session_expires_at = NOW() + INTERVAL '${SESSION_TTL_DAYS} days',
            updated_at = NOW()
      WHERE id = $1`,
    [userId, hashToken(session)]
  );
  return session; // en claro, solo para el cliente
}

/**
 * POST /auth/magic-link  { email }
 * Genera un enlace de acceso de un solo uso (15 min). Rate limit estricto.
 */
authRouter.post('/magic-link', rateLimit(5, 60 * 60_000), async (c) => {
  try {
    const { email } = await c.req.json<{ email?: string }>();
    const clean = (email ?? '').trim().toLowerCase();
    if (clean.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean)) {
      return c.json({ error: 'invalid_email', message: 'Ese email no parece válido — revísalo y probamos de nuevo.' }, 400);
    }

    const token = newToken();
    await db.query(
      `INSERT INTO auth_tokens (token, email, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '${MAGIC_LINK_TTL_MIN} minutes')`,
      [hashToken(token), clean]
    );
    const link = `${WEB_BASE}/login?token=${token}`;

    if (!process.env['SMTP_HOST']) {
      if (DEV_LINKS) {
        console.log(`[auth] 🔗 (DEV) Magic link para ${clean}: ${link}`);
        return c.json({ sent: true, devLink: link });
      }
      // Producción sin SMTP: NO filtrar el enlace jamás.
      console.error('[auth] SMTP_HOST no configurado: no se puede enviar el magic link');
      return c.json({ error: 'email_not_configured' }, 503);
    }

    const { sendMagicLink } = await import('../lib/mailer.js');
    await sendMagicLink(clean, link);
    return c.json({ sent: true });
  } catch (err) {
    console.error('[auth] magic-link error:', err);
    return c.json({ error: 'server_error' }, 500);
  }
});

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
    console.error('[auth] verify error:', err);
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
    const adopted = await db.query<{ id: string }>(
      `UPDATE users SET email = $2, updated_at = NOW()
       WHERE device_id = $1 AND email IS NULL RETURNING id`,
      [deviceId, email]
    );
    userId = adopted.rows[0]?.id;
  }
  if (!userId) {
    const created = await db.query<{ id: string }>(
      `INSERT INTO users (device_id, email) VALUES ($1, $2) RETURNING id`,
      [deviceId || `email:${email}`, email]
    );
    userId = created.rows[0]!.id;
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

  const deviceId = c.req.query('device_id') ?? '';
  // State FIRMADO (HMAC): el callback lo verifica → no se acepta un state ajeno.
  const state = signState({ d: deviceId, n: randomBytes(8).toString('hex') });

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
    console.error('[auth] google login failed:', reason);
    return c.redirect(`${WEB_BASE}/login#error=${reason}`);
  };

  try {
    if (!clientId || !clientSecret) return fail('google_not_configured');
    const code = c.req.query('code');
    if (!code) return fail('google_denied');

    // Verificar el state firmado (CSRF). Si no valida, abortar.
    const st = verifyState(c.req.query('state'));
    if (!st) return fail('bad_state');
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
      console.error(`[auth] google token exchange ${tokenRes.status}; redirect_uri=${redirectUri}; resp=${detail}`);
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

    const session = await openSession(userId);
    return c.redirect(
      `${WEB_BASE}/login#session=${encodeURIComponent(session)}&email=${encodeURIComponent(email)}`
    );
  } catch (err) {
    console.error('[auth] google callback error:', err);
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
 * POST /auth/favorites/merge  { teams: string[], leagues: string[], players: string[] }
 * Fusiona los favoritos locales (anónimos) con los de la cuenta. Idempotente.
 */
authRouter.post('/favorites/merge', async (c) => {
  const user = await userFromBearer(c.req.header('Authorization'));
  if (!user) return c.json({ error: 'unauthorized' }, 401);

  try {
    const { teams = [], leagues = [], players = [] } =
      await c.req.json<{ teams?: string[]; leagues?: string[]; players?: string[] }>();

    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const insert = async (kind: 'team' | 'league' | 'player', ids: string[]) => {
      for (const id of ids.slice(0, 200)) { // tope defensivo de tamaño
        if (!UUID.test(id)) continue;
        await db.query(
          `INSERT INTO user_favorites (user_id, kind, ref_id)
           VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
          [user.id, kind, id]
        );
      }
    };
    await insert('team', teams);
    await insert('league', leagues);
    await insert('player', players);

    const all = await db.query<{ kind: string; ref_id: string }>(
      `SELECT kind, ref_id FROM user_favorites WHERE user_id = $1`, [user.id]
    );
    return c.json({
      teams:   all.rows.filter((r) => r.kind === 'team').map((r) => r.ref_id),
      leagues: all.rows.filter((r) => r.kind === 'league').map((r) => r.ref_id),
      players: all.rows.filter((r) => r.kind === 'player').map((r) => r.ref_id),
    });
  } catch (err) {
    console.error('[auth] merge error:', err);
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
