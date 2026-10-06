// Sentry PRIMERO: instrumenta interceptando la carga de módulos (ver instrument.ts).
import './instrument.js';
import * as Sentry from '@sentry/node';
import { pathToFileURL } from 'node:url';
import { createLogger } from '@sports/logger';
import { closeDb, db, listActiveAnnualPurchases, withTransaction } from '@sports/db';
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
 * ATOMICIDAD (spec §6: "el estado de play_purchases se actualiza en la misma
 * transacción que la concesión/revocación"): cada par de escrituras (users +
 * play_purchases) va en UNA transacción. Sin ello, un proceso caído a mitad
 * dejaría un reembolsado con `premium_lifetime=TRUE` para siempre y en
 * silencio (al día siguiente el `state <> 'revoked'` se saltaría el token).
 *
 * Cada acción queda en log EXPLÍCITO. Nunca CONCEDE premium (solo mantiene lo
 * ya verificado en /payments/play/verify). Sin lock del pipeline: no compite
 * con scraping (patrón partition-guard).
 *
 * Uso:  node dist/apps/etl/src/play-reconcile.js
 */

const log = createLogger({ service: 'play-reconcile' });

/**
 * Circuit-breaker del lote de suscripciones: con Google caído y cientos de
 * suscriptores, cada revalidación paga su timeout (15 s) y el lote entero
 * superaría el healthcheck del contenedor (2700 s), muriendo a mitad del
 * bloque diario. Tras N fallos CONSECUTIVOS se aborta: exitCode ya queda en 1
 * por los errores acumulados y el resto se reintenta mañana (idempotente).
 */
const MAX_CONSECUTIVE_ERRORS = 5;

export type ReconcileOutcome = 'extended' | 'expired' | 'unchanged' | 'error';

/** Réplica del tokenPrefix de payments-play.ts: correlacionar un incidente sin
 *  volar el token completo al log; el token íntegro solo en parámetros SQL. */
function tokenPrefix(purchaseToken: string): string {
  return purchaseToken.slice(0, 8);
}

/**
 * Revalida UNA suscripción anual contra Google y sincroniza BD. Nunca
 * propaga: cualquier excepción (PlayApiError de Google, fallo de BD…) sale
 * como 'error' con log detallado para no abortar el resto del lote.
 *
 * Clasificación extended/unchanged por valor PRE-update: se lee el
 * `premium_until` vigente ANTES de escribir; `current >= expiresAt - 1 s`
 * (tolerancia de 1 s por el round-trip de timestamptz) ⇒ 'unchanged', si no
 * ⇒ 'extended'. La transacción corre IGUAL en ambos casos — la etiqueta es
 * solo la métrica del resumen, no un atajo que evite la escritura.
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
      // Narrowing estable para el closure de la transacción (TS no conserva el
      // de `sub.expiresAt` dentro de una callback).
      const expiresAt = sub.expiresAt;
      // Métrica PRE-update (job diario, volumen bajo: esta query extra es
      // irrelevante frente a la llamada a Google que ya se ha hecho).
      const cur = await db.query<{ premium_until: Date | null }>(
        `SELECT premium_until FROM users WHERE id = $1`,
        [userId],
      );
      const currentMs = cur.rows[0]?.premium_until
        ? new Date(cur.rows[0].premium_until).getTime()
        : 0;
      const outcome: ReconcileOutcome =
        currentMs >= expiresAt.getTime() - 1_000 ? 'unchanged' : 'extended';
      // Una sola transacción (spec §6): users y play_purchases se escriben
      // juntas o no se escriben.
      await withTransaction(async (tx) => {
        await tx.query(
          `UPDATE users
              SET premium_until = GREATEST(COALESCE(premium_until, NOW()), $2::timestamptz),
                  updated_at = NOW()
            WHERE id = $1`,
          [userId, expiresAt.toISOString()],
        );
        await tx.query(
          `UPDATE play_purchases
              SET state = 'active', expires_at = $2, updated_at = NOW()
            WHERE purchase_token = $1`,
          [purchaseToken, expiresAt.toISOString()],
        );
      });
      return outcome;
    }
    // No activa en Google (expirada, revocada, pendiente…): la compra deja de
    // estar activa. users NO se toca — premium_until sigue en el pasado y el
    // guard excluye al usuario por fecha. Escritura única: sin transacción.
    await db.query(
      `UPDATE play_purchases
          SET state = 'expired', updated_at = NOW()
        WHERE purchase_token = $1`,
      [purchaseToken],
    );
    log.warn(
      { purchaseToken: tokenPrefix(purchaseToken), userId },
      '[play-reconcile] suscripción expirada/revocada en Play',
    );
    return 'expired';
  } catch (err) {
    log.error(
      { err, purchaseToken: tokenPrefix(purchaseToken), userId },
      '[play-reconcile] error revalidando suscripción',
    );
    return 'error';
  }
}

/**
 * Procesa los reembolsos (voidedpurchases). Devuelve cuántos ha revocado en
 * esta pasada y si algo falló — el listado a Google o alguna revocación
 * individual — para que main() lo sume a `errors` y el exitCode sea honesto.
 *
 * Cada revocación es SU transacción: revocar la compra y quitar el lifetime
 * van juntas (spec §6). Un fallo en una revocación hace rollback de ese par,
 * marca `failed` y el lote CONTINÚA con el siguiente token; el job del día
 * siguiente reintenta el caído (idempotente por `state <> 'revoked'`).
 */
export async function reconcileVoided(
  _now: Date = new Date(),
): Promise<{ revoked: number; failed: boolean }> {
  if (!getPlayCredentials().email) {
    log.warn('[play-reconcile] Play sin configurar: reembolsos no revisados');
    return { revoked: 0, failed: false };
  }
  let voided: Array<{ purchaseToken: string | null }>;
  try {
    voided = await listVoidedPurchases();
  } catch (err) {
    log.error({ err }, '[play-reconcile] error listando voidedpurchases');
    return { revoked: 0, failed: true };
  }
  let revoked = 0;
  let failed = false;
  for (const v of voided) {
    const purchaseToken = v.purchaseToken;
    if (!purchaseToken) continue;
    try {
      const row = await withTransaction(async (tx) => {
        const res = await tx.query<{ user_id: string; product_id: string }>(
          `UPDATE play_purchases
              SET state = 'revoked', updated_at = NOW()
            WHERE purchase_token = $1 AND state <> 'revoked'
            RETURNING user_id, product_id`,
          [purchaseToken],
        );
        const first = res.rows[0];
        if (!first) return null;
        if (first.product_id === 'premium_lifetime') {
          await tx.query(
            `UPDATE users
                SET premium_lifetime = FALSE, updated_at = NOW()
              WHERE id = $1`,
            [first.user_id],
          );
        }
        return first;
      });
      if (!row) continue; // ya estaba 'revoked': idempotente, sin log repetido
      log.warn(
        {
          purchaseToken: tokenPrefix(purchaseToken),
          userId: row.user_id,
          product: row.product_id,
        },
        '[play-reconcile] compra REEMBOLSADA: premium revocado',
      );
      // Sentry en CADA revocación (no solo en el resumen de main): es un
      // evento de dinero y el job corre UNA vez al día — sin aviso puntual,
      // la revocación podría pasar inadvertida 24 h entre logs de rutina.
      Sentry.captureMessage('[play-reconcile] compra REEMBOLSADA: premium revocado', {
        level: 'warning',
        extra: {
          purchaseToken: tokenPrefix(purchaseToken),
          userId: row.user_id,
          product: row.product_id,
        },
      });
      revoked += 1;
    } catch (err) {
      // La TX ha hecho rollback (withTransaction): ni compra revocada a medias
      // ni lifetime quitado sin revocar. Se cuenta el fallo y se sigue.
      failed = true;
      log.error(
        { err, purchaseToken: tokenPrefix(purchaseToken) },
        '[play-reconcile] error revocando compra (rollback); se reintenta mañana',
      );
    }
  }
  return { revoked, failed };
}

export async function main(): Promise<void> {
  const purchases = await listActiveAnnualPurchases();
  log.info({ total: purchases.length }, '[play-reconcile] revalidando suscripciones');
  let extended = 0;
  let unchanged = 0;
  let expired = 0;
  let errors = 0;
  let consecutiveErrors = 0;
  for (let i = 0; i < purchases.length; i++) {
    const row = purchases[i]!;
    const outcome = await reconcileSubscription(row.purchase_token, row.user_id);
    if (outcome === 'error') {
      errors += 1;
      consecutiveErrors += 1;
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        log.error(
          { consecutiveErrors, remaining: purchases.length - i - 1 },
          `abortando el lote: ${consecutiveErrors} fallos consecutivos (¿Google caído?)`,
        );
        break; // el circuit-breaker evita agotar el healthcheck; reintenta mañana
      }
      continue;
    }
    consecutiveErrors = 0; // un éxito rompe la racha: el fallo era puntual
    if (outcome === 'extended') extended += 1;
    else if (outcome === 'unchanged') unchanged += 1;
    else expired += 1;
  }
  const { revoked, failed } = await reconcileVoided();
  if (failed) errors += 1; // los fallos de reembolsos también cuentan (exitCode honesto)
  log.info({ extended, unchanged, expired, voided: revoked, errors }, '[play-reconcile] fin');
  if (errors > 0) {
    process.exitCode = 1; // explícito para el scheduler
    // Sentry al cierre si hubo errores: una corrida al día — sin este aviso,
    // un fallo (p. ej. SA rota con 401) sería invisible 24 h.
    Sentry.captureMessage(`[play-reconcile] fin con ${errors} error(es)`, { level: 'warning' });
  }
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
