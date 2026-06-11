import { Hono } from 'hono';
import { timingSafeEqual } from 'node:crypto';
import { db } from '@sports/db';

/**
 * Panel de administración — nivel 1 (token compartido).
 *
 * Autenticación: cabecera `X-Admin-Token` comparada (en tiempo constante)
 * con la variable de entorno ADMIN_TOKEN. Si ADMIN_TOKEN no está definida,
 * TODAS las rutas de admin responden 503: nunca un admin abierto por defecto.
 *
 *   GET    /admin/users            — listado con favoritos, premium y estado
 *   PATCH  /admin/users/:id/status — { status: 'active' | 'disabled' }
 *   DELETE /admin/users/:id        — borrado definitivo (cascade en favoritos)
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
        (u.session_token IS NOT NULL)                    AS has_session,
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
    return c.json({ error: 'Database error', detail: err instanceof Error ? err.message : '' }, 500);
  }
});

adminRouter.patch('/users/:id/status', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({})) as { status?: string };
  if (body.status !== 'active' && body.status !== 'disabled') {
    return c.json({ error: "status must be 'active' or 'disabled'" }, 400);
  }

  try {
    // Al desactivar, invalidar también la sesión: expulsión inmediata
    const res = await db.query(
      body.status === 'disabled'
        ? `UPDATE users SET status = $2, session_token = NULL, updated_at = NOW() WHERE id = $1 RETURNING id, status`
        : `UPDATE users SET status = $2, updated_at = NOW() WHERE id = $1 RETURNING id, status`,
      [id, body.status]
    );
    if (res.rowCount === 0) return c.json({ error: 'User not found' }, 404);
    return c.json({ ok: true, user: res.rows[0] });
  } catch (err) {
    return c.json({ error: 'Database error', detail: err instanceof Error ? err.message : '' }, 500);
  }
});

adminRouter.delete('/users/:id', async (c) => {
  const id = c.req.param('id');
  try {
    const res = await db.query(`DELETE FROM users WHERE id = $1 RETURNING id`, [id]);
    if (res.rowCount === 0) return c.json({ error: 'User not found' }, 404);
    return c.json({ ok: true, deleted: id });
  } catch (err) {
    // orders referencia users sin ON DELETE: si tiene pedidos, no se puede borrar
    return c.json({
      error: 'Cannot delete user (may have payment orders). Disable it instead.',
      detail: err instanceof Error ? err.message : '',
    }, 409);
  }
});
