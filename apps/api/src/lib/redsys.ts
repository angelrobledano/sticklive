/**
 * Utilidades de firma Redsys (protocolo HMAC_SHA256_V1)
 *
 * Algoritmo oficial (basado en el SDK PHP de Redsys):
 *   1. Decodificar la clave secreta del comercio desde Base64.
 *   2. Cifrar el DS_MERCHANT_ORDER con 3DES-CBC (IV = 8 bytes a cero,
 *      padding manual con null bytes hasta múltiplo de 8).
 *      → Clave derivada.
 *   3. HMAC-SHA256 del Ds_MerchantParameters (string Base64) con la
 *      clave derivada → firma en bytes crudos.
 *   4. Codificar la firma en Base64 estándar.
 *
 * Referencias:
 *   https://pagosonline.redsys.es/desarrolladores-web/integracion-por-redireccion
 */

import { createCipheriv, createHmac, timingSafeEqual } from 'node:crypto';

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface RedsysMerchantParams {
  /** Importe en céntimos: 499 = 4,99 € */
  amount: number;
  /** Número de pedido: exactamente 12 caracteres alfanuméricos, empezando por 4 dígitos */
  order: string;
  /** Código de comercio asignado por Redsys / banco */
  merchantCode: string;
  /** 978 = EUR */
  currency?: string;
  /** 0 = Autorización estándar */
  transactionType?: string;
  /** URL del webhook servidor a servidor */
  merchantUrl: string;
  /** URL de redireccionamiento tras pago OK */
  urlOk: string;
  /** URL de redireccionamiento tras pago KO */
  urlKo: string;
  /** Nombre del comercio mostrado en la pasarela */
  merchantName?: string;
  /** Terminal asignado por el banco */
  terminal?: string;
}

export interface RedsysFormPayload {
  Ds_SignatureVersion: 'HMAC_SHA256_V1';
  Ds_MerchantParameters: string;
  Ds_Signature: string;
}

/** Parámetros devueltos por Redsys en el webhook / redirect */
export interface RedsysNotificationParams {
  Ds_Order: string;
  Ds_Response: string;
  Ds_AuthorisationCode?: string;
  Ds_CardCountry?: string;
  Ds_Amount?: string;
  Ds_Currency?: string;
  Ds_MerchantCode?: string;
  [key: string]: string | undefined;
}

// ─── Helpers internos ─────────────────────────────────────────────────────────

/**
 * Deriva la clave de firma cifrando el número de pedido con 3DES-CBC.
 * Replica exactamente el comportamiento de mcrypt en PHP:
 *   - Padding manual con null bytes hasta múltiplo de 8 (sin bloque extra).
 *   - IV = 8 bytes a cero.
 *   - Sin auto-padding de OpenSSL (equivalente a mcrypt sin PKCS7).
 */
function derive3DESKey(order: string, secretKeyBase64: string): Buffer {
  const keyBuffer = Buffer.from(secretKeyBase64, 'base64');

  // Pad del número de pedido a múltiplo de 8 con null bytes
  const orderBytes  = Buffer.from(order, 'utf8');
  const paddedLen   = Math.max(8, Math.ceil(orderBytes.length / 8) * 8);
  const padded      = Buffer.alloc(paddedLen, 0);
  orderBytes.copy(padded);

  const iv     = Buffer.alloc(8, 0);
  const cipher = createCipheriv('des-ede3-cbc', keyBuffer, iv);
  cipher.setAutoPadding(false); // mcrypt no usa PKCS7

  return Buffer.concat([cipher.update(padded), cipher.final()]);
}

/**
 * HMAC-SHA256 de un string (los Ds_MerchantParameters en Base64)
 * usando la clave derivada. Devuelve Base64 estándar.
 */
function hmacSha256Base64(data: string, derivedKey: Buffer): string {
  return createHmac('sha256', derivedKey)
    .update(data, 'utf8')
    .digest('base64');
}

// ─── API pública ──────────────────────────────────────────────────────────────

/**
 * Genera el número de pedido Redsys de 12 caracteres.
 * Formato: últimos 12 dígitos del timestamp + sufijo para unicidad.
 * Redsys exige que empiece por al menos 4 dígitos numéricos.
 */
export function generateDsOrder(): string {
  const ts   = String(Date.now()); // 13 dígitos en 2024+
  const rand = Math.floor(Math.random() * 100).toString().padStart(2, '0');
  // Tomamos 10 dígitos del timestamp + 2 random → 12 chars, todos numéricos
  return (ts.slice(-10) + rand).slice(-12);
}

/**
 * Construye el payload firmado para el formulario de Redsys.
 *
 * @param params  Parámetros del pedido
 * @param secret  REDSYS_SECRET_KEY (Base64 de la clave del comercio)
 * @returns       { Ds_SignatureVersion, Ds_MerchantParameters, Ds_Signature }
 */
export function buildRedsysPayload(
  params: RedsysMerchantParams,
  secret: string
): RedsysFormPayload {
  // 1. JSON de parámetros tal como exige Redsys
  const paramsJson = JSON.stringify({
    DS_MERCHANT_AMOUNT:          String(params.amount),
    DS_MERCHANT_ORDER:           params.order,
    DS_MERCHANT_MERCHANTCODE:    params.merchantCode,
    DS_MERCHANT_CURRENCY:        params.currency        ?? '978',
    DS_MERCHANT_TRANSACTIONTYPE: params.transactionType ?? '0',
    DS_MERCHANT_TERMINAL:        params.terminal        ?? '1',
    DS_MERCHANT_MERCHANTURL:     params.merchantUrl,
    DS_MERCHANT_URLOK:           params.urlOk,
    DS_MERCHANT_URLKO:           params.urlKo,
    ...(params.merchantName
      ? { DS_MERCHANT_MERCHANTNAME: params.merchantName }
      : {}),
  });

  // 2. Base64 del JSON → Ds_MerchantParameters
  const merchantParameters = Buffer.from(paramsJson, 'utf8').toString('base64');

  // 3. Clave derivada con 3DES-CBC sobre el número de pedido
  const derivedKey = derive3DESKey(params.order, secret);

  // 4. HMAC-SHA256 del Base64 → Ds_Signature
  const signature = hmacSha256Base64(merchantParameters, derivedKey);

  return {
    Ds_SignatureVersion:   'HMAC_SHA256_V1',
    Ds_MerchantParameters: merchantParameters,
    Ds_Signature:          signature,
  };
}

/**
 * Verifica la firma de la notificación de Redsys (webhook/redirect).
 * Devuelve true si la firma es válida.
 *
 * @param merchantParameters  Ds_MerchantParameters recibido (Base64)
 * @param receivedSignature   Ds_Signature recibida (Base64)
 * @param order               DS_ORDER extraído de los parámetros decodificados
 * @param secret              REDSYS_SECRET_KEY
 */
export function verifyRedsysSignature(
  merchantParameters: string,
  receivedSignature: string,
  order: string,
  secret: string
): boolean {
  try {
    const derivedKey     = derive3DESKey(order, secret);
    const expectedSig    = hmacSha256Base64(merchantParameters, derivedKey);

    // Comparación en tiempo constante para evitar timing attacks
    const expected = Buffer.from(expectedSig,       'base64');
    const received = Buffer.from(receivedSignature, 'base64');

    if (expected.length !== received.length) return false;
    return timingSafeEqual(expected, received);
  } catch {
    return false;
  }
}

/**
 * Decodifica Ds_MerchantParameters (Base64 → JSON → objeto).
 */
export function decodeMerchantParameters(merchantParameters: string): RedsysNotificationParams {
  const json = Buffer.from(merchantParameters, 'base64').toString('utf8');
  return JSON.parse(json) as RedsysNotificationParams;
}

/**
 * Devuelve true si el código de respuesta Redsys indica pago autorizado
 * (entre 0000 y 0099 inclusive).
 */
export function isAuthorizedResponse(dsResponse: string): boolean {
  const code = parseInt(dsResponse, 10);
  return !isNaN(code) && code >= 0 && code <= 99;
}
