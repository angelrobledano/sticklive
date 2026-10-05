/**
 * Resolución de sesión Bearer → usuario.
 *
 * Vive en lib (y no en routes/auth.ts) porque no solo el router de auth la
 * necesita: los endpoints de push nativo asocian el token del dispositivo al
 * usuario de la sesión OPCIONAL (Task 4.1). Misma consulta, mismo sliding
 * renewal, una sola fuente de verdad.
 *
 * Los tokens viajan en claro al cliente y se guardan HASHEADOS en BD
 * (SHA-256): una fuga de la tabla no filtra sesiones usables.
 */
import { createHash } from 'node:crypto';
import { db } from '@sports/db';

// Vida de las sesiones (la comparte openSession en routes/auth.ts: el tope de
// expulsión por inactividad y la renovación sliding usan el MISMO valor).
export const SESSION_TTL_DAYS = 90;

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface SessionUser {
  id: string;
  email: string | null;
}

/**
 * Resuelve el usuario de la cabecera Authorization (Bearer) o null si no hay
 * sesión válida. Renueva la caducidad en sliding: cada uso empuja expires_at
 * a +SESSION_TTL_DAYS, acotando la escritura a una vez al día por sesión.
 */
export async function userFromBearer(
  authHeader: string | undefined
): Promise<SessionUser | null> {
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
