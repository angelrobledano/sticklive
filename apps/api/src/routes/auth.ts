import { Hono } from 'hono';
import { randomBytes } from 'node:crypto';
import { db } from '@sports/db';

export const authRouter = new Hono();

const MAGIC_LINK_TTL_MIN = 15;
const WEB_BASE = process.env['WEB_BASE_URL'] ?? 'http://localhost:3001';
// Mientras no haya SMTP configurado, el enlace se devuelve en la respuesta
// (modo dev). Con SMTP_HOST definido, se enviaría por email y NUNCA se expone.
const DEV_MODE = !process.env['SMTP_HOST'];

function newToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

async function userFromBearer(authHeader: string | undefined) {
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  if (!token) return null;
  const res = await db.query<{ id: string; email: string | null }>(
    `SELECT id, email FROM users WHERE session_token = $1 AND status = 'active'`, [token]
  );
  return res.rows[0] ?? null;
}

/**
 * POST /auth/magic-link  { email, deviceId? }
 * Genera un enlace de acceso de un solo uso (15 min).
 */
authRouter.post('/magic-link', async (c) => {
  try {
    const { email } = await c.req.json<{ email?: string }>();
    const clean = (email ?? '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean)) {
      return c.json({ error: 'invalid_email', message: 'Ese email no parece válido — revísalo y probamos de nuevo.' }, 400);
    }

    const token = newToken();
    await db.query(
      `INSERT INTO auth_tokens (token, email, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '${MAGIC_LINK_TTL_MIN} minutes')`,
      [token, clean]
    );

    const link = `${WEB_BASE}/login?token=${token}`;
    if (DEV_MODE) {
      console.log(`[auth] 🔗 Magic link para ${clean}: ${link}`);
      return c.json({ sent: true, devLink: link });
    }

    // Producción: el enlace viaja SOLO por email
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
authRouter.post('/verify', async (c) => {
  try {
    const { token, deviceId } = await c.req.json<{ token?: string; deviceId?: string }>();
    if (!token) return c.json({ error: 'missing_token' }, 400);

    const tokenRes = await db.query<{ id: string; email: string }>(
      `UPDATE auth_tokens SET used_at = NOW()
       WHERE token = $1 AND used_at IS NULL AND expires_at > NOW()
       RETURNING id, email`,
      [token]
    );
    if (tokenRes.rows.length === 0) {
      return c.json({
        error: 'expired',
        message: 'Vaya, el enlace ha caducado. No te preocupes, introduce tu email de nuevo y te enviamos uno fresquito al instante.',
      }, 410);
    }
    const email = tokenRes.rows[0]!.email;

    // Usuario por email; si no existe, adoptar el usuario anónimo del
    // dispositivo (conserva premium/config) o crear uno nuevo.
    let userRes = await db.query<{ id: string; status?: string }>(
      `SELECT id, status FROM users WHERE LOWER(email) = $1`, [email]
    );
    if (userRes.rows[0]?.status === 'disabled') {
      return c.json({ error: 'account_disabled' }, 403);
    }
    let userId = userRes.rows[0]?.id;

    if (!userId && deviceId) {
      userRes = await db.query<{ id: string }>(
        `UPDATE users SET email = $2, updated_at = NOW()
         WHERE device_id = $1 AND email IS NULL RETURNING id`,
        [deviceId, email]
      );
      userId = userRes.rows[0]?.id;
    }
    if (!userId) {
      userRes = await db.query<{ id: string }>(
        `INSERT INTO users (device_id, email) VALUES ($1, $2) RETURNING id`,
        [deviceId ?? `email:${email}`, email]
      );
      userId = userRes.rows[0]!.id;
    }

    // Rotar sesión
    const session = newToken();
    await db.query(`UPDATE users SET session_token = $2, updated_at = NOW() WHERE id = $1`, [userId, session]);

    return c.json({ session, email });
  } catch (err) {
    console.error('[auth] verify error:', err);
    return c.json({ error: 'server_error' }, 500);
  }
});

// ── Google OAuth ──────────────────────────────────────────────────────────────
// Flujo web clásico: /auth/google redirige a Google; /auth/google/callback
// canjea el code, extrae el email verificado y abre sesión con la misma
// lógica que el magic link. La sesión vuelve a la web en el fragment (#),
// que no viaja en logs ni referers.

const GOOGLE_AUTH_URL  = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API_PUBLIC = process.env['API_BASE_URL'] ?? 'http://localhost:3000';

authRouter.get('/google', (c) => {
  const clientId = process.env['GOOGLE_CLIENT_ID'];
  if (!clientId) return c.json({ error: 'google_not_configured' }, 503);

  const deviceId = c.req.query('device_id') ?? '';
  const state = Buffer.from(JSON.stringify({
    d: deviceId,
    n: randomBytes(8).toString('hex'),
  })).toString('base64url');

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
  const fail = (reason: string) => c.redirect(`${WEB_BASE}/login#error=${reason}`);

  try {
    if (!clientId || !clientSecret) return fail('google_not_configured');
    const code = c.req.query('code');
    if (!code) return fail('google_denied');

    // deviceId del estado (para adoptar al usuario anónimo del dispositivo)
    let deviceId = '';
    try {
      const st = JSON.parse(Buffer.from(c.req.query('state') ?? '', 'base64url').toString());
      deviceId = typeof st.d === 'string' ? st.d : '';
    } catch { /* estado ilegible → seguimos sin deviceId */ }

    // Canjear el code por tokens
    const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: `${API_PUBLIC}/auth/google/callback`,
        grant_type: 'authorization_code',
      }),
    });
    if (!tokenRes.ok) return fail('google_token');
    const tokens = await tokenRes.json() as { id_token?: string };
    if (!tokens.id_token) return fail('google_token');

    // Email verificado del id_token (validamos audiencia y verificación)
    const payload = JSON.parse(
      Buffer.from(tokens.id_token.split('.')[1] ?? '', 'base64url').toString()
    ) as { aud?: string; email?: string; email_verified?: boolean };
    if (payload.aud !== clientId || !payload.email || payload.email_verified !== true) {
      return fail('google_email');
    }
    const email = payload.email.toLowerCase();

    // Misma lógica de cuenta que el magic link
    let userRes = await db.query<{ id: string; status?: string }>(
      `SELECT id, status FROM users WHERE LOWER(email) = $1`, [email]
    );
    if (userRes.rows[0]?.status === 'disabled') return fail('account_disabled');
    let userId = userRes.rows[0]?.id;

    if (!userId && deviceId) {
      userRes = await db.query<{ id: string }>(
        `UPDATE users SET email = $2, updated_at = NOW()
         WHERE device_id = $1 AND email IS NULL RETURNING id`,
        [deviceId, email]
      );
      userId = userRes.rows[0]?.id;
    }
    if (!userId) {
      userRes = await db.query<{ id: string }>(
        `INSERT INTO users (device_id, email) VALUES ($1, $2) RETURNING id`,
        [deviceId || `email:${email}`, email]
      );
      userId = userRes.rows[0]!.id;
    }

    const session = newToken();
    await db.query(
      `UPDATE users SET session_token = $2, updated_at = NOW() WHERE id = $1`,
      [userId, session]
    );

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
 * POST /auth/favorites/merge  { teams: string[], leagues: string[] }
 * Fusiona los favoritos locales (anónimos) con los de la cuenta y
 * devuelve el resultado combinado. Idempotente.
 */
authRouter.post('/favorites/merge', async (c) => {
  const user = await userFromBearer(c.req.header('Authorization'));
  if (!user) return c.json({ error: 'unauthorized' }, 401);

  try {
    const { teams = [], leagues = [], players = [] } =
      await c.req.json<{ teams?: string[]; leagues?: string[]; players?: string[] }>();

    const insert = async (kind: 'team' | 'league' | 'player', ids: string[]) => {
      for (const id of ids) {
        if (!/^[0-9a-f-]{36}$/i.test(id)) continue;
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
