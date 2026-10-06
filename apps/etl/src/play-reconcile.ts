// Sentry PRIMERO: instrumenta interceptando la carga de módulos (ver instrument.ts).
import './instrument.js';
import * as Sentry from '@sentry/node';
import { pathToFileURL } from 'node:url';
import { createLogger } from '@sports/logger';
import { closeDb, db, listActiveAnnualPurchases } from '@sports/db';
import {
  getPlayCredentials,
  getSubscription,
  listVoidedPurchases,
} from '../../api/src/lib/play.js';

/**
 * play-reconcile (cron diario, spec monetización §6): sincroniza el premium de
 * Google Play con la realidad de Google. Dos pases:
 *
 *   1. Suscripciones anuales activas de `play_purchases` → revalidar con
 *      subscriptionsv2. Renovada → extiende `users.premium_until` (GREATEST:
 *      nunca acorta un derecho ya concedido) y deja state='active'; expirada →
 *      state='expired' SIN tocar users (el guard la excluye por fecha).
 *   2. voidedpurchases → reembolsos: state='revoked'; si era premium_lifetime
 *      quita `users.premium_lifetime`. Idempotente: un token ya revocado no
 *      repite UPDATE ni log.
 *
 * Cada acción queda en log EXPLÍCITO. Nunca CONCEDE premium (solo mantiene lo
 * ya verificado en /payments/play/verify). Sin lock del pipeline: no compite
 * con scraping (patrón partition-guard). Un fallo de Google en una compra no
 * aborta el lote: se registra y se continúa (exitCode 1 al final si hubo
 * errores, para que el `|| echo` del scheduler deje constancia).
 *
 * Uso:  node dist/apps/etl/src/play-reconcile.js
 */

const log = createLogger({ service: 'play-reconcile' });

export type ReconcileOutcome = 'extended' | 'expired' | 'unchanged' | 'error';

/**
 * Revalida UNA suscripción anual contra Google y sincroniza BD. Nunca
 * propaga: cualquier excepción (PlayApiError de Google, fallo de BD…) sale
 * como 'error' con log detallado para no abortar el resto del lote.
 *
 * `_now` reserva la posición temporal de la firma del plan; hoy la fecha de
 * corte la pone la BD (NOW() en el GREATEST) y los tests no la necesitan.
 */
export async function reconcileSubscription(
  purchaseToken: string,
  userId: string,
  _now: Date = new Date(),
): Promise<ReconcileOutcome> {
  try {
    const sub = await getSubscription(purchaseToken, 'premium_annual');
    if (sub.active && sub.expiresAt) {
      const res = await db.query<{ premium_until: Date | null }>(
        `UPDATE users
            SET premium_until = GREATEST(COALESCE(premium_until, NOW()), $2::timestamptz),
                updated_at = NOW()
          WHERE id = $1
          RETURNING premium_until`,
        [userId, sub.expiresAt.toISOString()],
      );
      await db.query(
        `UPDATE play_purchases
            SET state = 'active', expires_at = $2, updated_at = NOW()
          WHERE purchase_token = $1`,
        [purchaseToken, sub.expiresAt.toISOString()],
      );
      // Tolerancia de 1 s: si RETURNING trae la misma fecha (round-trip de
      // timestamptz) no hay cambio real que contar. Trae el valor POST-update.
      const current = res.rows[0]?.premium_until
        ? new Date(res.rows[0].premium_until).getTime()
        : 0;
      return sub.expiresAt.getTime() > current - 1_000 ? 'extended' : 'unchanged';
    }
    // No activa en Google (expirada, revocada, pendiente…): la compra deja de
    // estar activa. users NO se toca — premium_until sigue en el pasado y el
    // guard excluye al usuario por fecha.
    await db.query(
      `UPDATE play_purchases
          SET state = 'expired', updated_at = NOW()
        WHERE purchase_token = $1`,
      [purchaseToken],
    );
    log.warn(
      { purchaseToken, userId },
      '[play-reconcile] suscripción expirada/revocada en Play',
    );
    return 'expired';
  } catch (err) {
    log.error({ err, purchaseToken, userId }, '[play-reconcile] error revalidando suscripción');
    return 'error';
  }
}

/**
 * Procesa los reembolsos (voidedpurchases). Devuelve cuántos ha revocado en
 * esta pasada. Nunca propaga: el fallo del listado se registra y se devuelve
 * lo acumulado hasta el momento.
 */
export async function reconcileVoided(_now: Date = new Date()): Promise<number> {
  if (!getPlayCredentials().email) {
    log.warn('[play-reconcile] Play sin configurar: reembolsos no revisados');
    return 0;
  }
  let revoked = 0;
  try {
    for (const v of await listVoidedPurchases()) {
      if (!v.purchaseToken) continue;
      // `state <> 'revoked'` hace la revocación idempotente: si ya estaba,
      // RETURNING no trae filas y no se repite el log ni el UPDATE de users.
      const res = await db.query<{ user_id: string; product_id: string }>(
        `UPDATE play_purchases
            SET state = 'revoked', updated_at = NOW()
          WHERE purchase_token = $1 AND state <> 'revoked'
          RETURNING user_id, product_id`,
        [v.purchaseToken],
      );
      const row = res.rows[0];
      if (!row) continue;
      if (row.product_id === 'premium_lifetime') {
        await db.query(
          `UPDATE users
              SET premium_lifetime = FALSE, updated_at = NOW()
            WHERE id = $1`,
          [row.user_id],
        );
      }
      log.warn(
        { purchaseToken: v.purchaseToken, userId: row.user_id, product: row.product_id },
        '[play-reconcile] compra REEMBOLSADA: premium revocado',
      );
      revoked += 1;
    }
  } catch (err) {
    log.error({ err, revoked }, '[play-reconcile] error procesando voidedpurchases');
  }
  return revoked;
}

export async function main(): Promise<void> {
  const purchases = await listActiveAnnualPurchases();
  log.info({ total: purchases.length }, '[play-reconcile] revalidando suscripciones');
  let extended = 0;
  let unchanged = 0;
  let expired = 0;
  let errors = 0;
  for (const row of purchases) {
    const outcome = await reconcileSubscription(row.purchase_token, row.user_id);
    if (outcome === 'extended') extended += 1;
    else if (outcome === 'unchanged') unchanged += 1;
    else if (outcome === 'expired') expired += 1;
    else errors += 1;
  }
  const voided = await reconcileVoided();
  log.info({ extended, unchanged, expired, voided, errors }, '[play-reconcile] fin');
  if (errors > 0) process.exitCode = 1; // explícito para el scheduler
}

// Sólo se ejecuta al lanzarlo directamente (scheduler), no al importarlo (tests).
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main()
    .catch((err) => {
      log.error({ err }, 'play-reconcile falló');
      Sentry.captureException(err);
      process.exitCode = 1;
    })
    // Proceso corto: hay que drenar Sentry antes de salir o se pierde el evento.
    .finally(async () => {
      await Sentry.flush(2000);
      await closeDb();
    });
}
