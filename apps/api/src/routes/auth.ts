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
    // TODO(producción): enviar `link` por email vía SMTP y no exponerlo
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
    const { teams = [], leagues = [] } = await c.req.json<{ teams?: string[]; leagues?: string[] }>();

    const insert = async (kind: 'team' | 'league', ids: string[]) => {
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

    const all = await db.query<{ kind: string; ref_id: string }>(
      `SELECT kind, ref_id FROM user_favorites WHERE user_id = $1`, [user.id]
    );
    return c.json({
      teams:   all.rows.filter((r) => r.kind === 'team').map((r) => r.ref_id),
      leagues: all.rows.filter((r) => r.kind === 'league').map((r) => r.ref_id),
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
