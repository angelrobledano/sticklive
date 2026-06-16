/**
 * Rutas de pago — Redsys HMAC_SHA256_V1
 * Prefijo: /payments/redsys
 *
 * POST /payments/redsys/create-json
 *   → Recibe { deviceId, email? }
 *   → Crea/reutiliza usuario, genera pedido, firma y devuelve el
 *     payload para que el front inyecte el formulario de Redsys.
 *
 * POST /payments/redsys/webhook
 *   → Endpoint servidor-a-servidor al que Redsys llama cuando el
 *     pago se completa (DS_MERCHANT_MERCHANTURL).
 *   → Valida firma, comprueba código de respuesta y activa premium.
 */

import { Hono } from 'hono';
import { logger } from '@sports/logger';
import {
  upsertUser,
  createOrder,
  findOrderByDsOrder,
  authorizeOrderAndGrantPremium,
  failOrder,
} from '@sports/db';
import {
  buildRedsysPayload,
  verifyRedsysSignature,
  decodeMerchantParameters,
  isAuthorizedResponse,
  generateDsOrder,
} from '../lib/redsys.js';

export const paymentsRouter = new Hono();

// ─── Configuración desde entorno ──────────────────────────────────────────────

function getRedsysConfig() {
  const secret       = process.env['REDSYS_SECRET_KEY'];
  const merchantCode = process.env['REDSYS_MERCHANT_CODE'];
  const terminal     = process.env['REDSYS_TERMINAL']     ?? '1';
  const apiBaseUrl   = process.env['API_BASE_URL']         ?? 'http://localhost:3000';
  const webBaseUrl   = process.env['WEB_BASE_URL']         ?? 'http://localhost:3001';

  if (!secret || !merchantCode) {
    throw new Error(
      'Faltan variables de entorno: REDSYS_SECRET_KEY y/o REDSYS_MERCHANT_CODE'
    );
  }

  return { secret, merchantCode, terminal, apiBaseUrl, webBaseUrl };
}

// ─── POST /create-json ────────────────────────────────────────────────────────

paymentsRouter.post('/create-json', async (c) => {
  try {
    const body = await c.req.json<{ deviceId?: string; email?: string }>();

    if (!body.deviceId || typeof body.deviceId !== 'string') {
      return c.json({ error: 'deviceId es obligatorio' }, 400);
    }

    const { secret, merchantCode, terminal, apiBaseUrl, webBaseUrl } =
      getRedsysConfig();

    // 1. Upsert usuario
    const user = await upsertUser(body.deviceId, body.email);

    if (user.is_premium) {
      return c.json({ error: 'Este dispositivo ya tiene Premium activo' }, 409);
    }

    // 2. Generar número de pedido único (12 dígitos)
    const dsOrder = generateDsOrder();

    // 3. Registrar pedido en DB
    await createOrder(user.id, dsOrder, 499);

    // 4. Construir y firmar payload Redsys
    const payload = buildRedsysPayload(
      {
        amount:       499,
        order:        dsOrder,
        merchantCode,
        terminal,
        merchantUrl:  `${apiBaseUrl}/payments/redsys/webhook`,
        urlOk:        `${webBaseUrl}/premium/success?order=${dsOrder}`,
        urlKo:        `${webBaseUrl}/premium/error?order=${dsOrder}`,
        merchantName: 'Rink Hockey',
      },
      secret
    );

    logger.info({ service: 'api', dsOrder, userId: user.id }, 'Redsys: pedido creado');

    return c.json(payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error desconocido';
    logger.error({ service: 'api', error: message }, 'Redsys /create-json error');
    return c.json({ error: 'Error al crear el pedido' }, 500);
  }
});

// ─── POST /webhook ────────────────────────────────────────────────────────────
// Redsys llama a esta URL de forma asíncrona (servidor a servidor).
// Debe responder con HTTP 200 y body vacío (o cualquier 2xx).

paymentsRouter.post('/webhook', async (c) => {
  try {
    // Redsys puede enviar application/x-www-form-urlencoded o JSON
    let merchantParameters: string;
    let receivedSignature: string;
    let signatureVersion: string;

    const contentType = c.req.header('content-type') ?? '';

    if (contentType.includes('application/x-www-form-urlencoded')) {
      const form = await c.req.formData();
      merchantParameters = String(form.get('Ds_MerchantParameters') ?? '');
      receivedSignature  = String(form.get('Ds_Signature')          ?? '');
      signatureVersion   = String(form.get('Ds_SignatureVersion')   ?? '');
    } else {
      const body = await c.req.json<{
        Ds_MerchantParameters?: string;
        Ds_Signature?: string;
        Ds_SignatureVersion?: string;
      }>();
      merchantParameters = body.Ds_MerchantParameters ?? '';
      receivedSignature  = body.Ds_Signature          ?? '';
      signatureVersion   = body.Ds_SignatureVersion   ?? '';
    }

    if (!merchantParameters || !receivedSignature) {
      logger.warn({ service: 'api' }, 'Redsys webhook: parámetros incompletos');
      return c.body('KO', 400);
    }

    if (signatureVersion !== 'HMAC_SHA256_V1') {
      logger.warn({ service: 'api', signatureVersion }, 'Redsys webhook: versión de firma no soportada');
      return c.body('KO', 400);
    }

    // 1. Decodificar parámetros
    const params = decodeMerchantParameters(merchantParameters);
    const dsOrder    = params['Ds_Order']            ?? '';
    const dsResponse = params['Ds_Response']         ?? '';
    const dsAuthCode = params['Ds_AuthorisationCode'] ?? null;
    const dsCardCountry = params['Ds_CardCountry']   ?? null;

    if (!dsOrder) {
      logger.warn({ service: 'api' }, 'Redsys webhook: Ds_Order vacío');
      return c.body('KO', 400);
    }

    // 2. Verificar firma para proteger contra fraudes
    const { secret } = getRedsysConfig();
    const isValid = verifyRedsysSignature(
      merchantParameters,
      receivedSignature,
      dsOrder,
      secret
    );

    if (!isValid) {
      logger.warn({ service: 'api', dsOrder }, 'Redsys webhook: firma inválida');
      return c.body('KO', 401);
    }

    // 3. Verificar que el pedido existe en nuestra DB
    const order = await findOrderByDsOrder(dsOrder);
    if (!order) {
      logger.warn({ service: 'api', dsOrder }, 'Redsys webhook: pedido desconocido');
      return c.body('KO', 404);
    }

    if (order.status !== 'pending') {
      // Idempotencia: ya procesado anteriormente
      logger.info({ service: 'api', dsOrder, status: order.status }, 'Redsys webhook: pedido ya procesado');
      return c.body('OK');
    }

    const webhookRaw: Record<string, unknown> = { ...params };

    // 4. Comprobar si el pago fue autorizado (0000-0099)
    if (isAuthorizedResponse(dsResponse)) {
      const { user } = await authorizeOrderAndGrantPremium(
        dsOrder,
        dsResponse,
        dsAuthCode ?? null,
        dsCardCountry ?? null,
        webhookRaw
      );

      logger.info({ service: 'api', dsOrder, userId: user.id, dsResponse }, 'Redsys webhook: pago autorizado — Premium activado');
    } else {
      // Pago rechazado o error
      await failOrder(dsOrder, dsResponse, webhookRaw);

      logger.info({ service: 'api', dsOrder, dsResponse }, 'Redsys webhook: pago no autorizado');
    }

    // Redsys espera respuesta 200 con body vacío o "OK"
    return c.body('OK');
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error desconocido';
    logger.error({ service: 'api', error: message }, 'Redsys webhook error');
    // Devolvemos 200 igualmente para que Redsys no reintente indefinidamente
    return c.body('KO', 500);
  }
});
