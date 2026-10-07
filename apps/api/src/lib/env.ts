/**
 * Validación de entorno al arranque ("fail fast").
 *
 * En vez de degradar en silencio con fallbacks peligrosos (un magic link en la
 * respuesta, CORS '*', un UUID placeholder), la API aborta al arrancar si falta
 * algo crítico, con un mensaje claro. Las variables OPCIONALES (que activan
 * features) solo se avisan por log.
 */
import { logger } from '@sports/logger';

/** Obligatorias SIEMPRE: sin ellas la API no puede funcionar de forma segura. */
const REQUIRED = ['DATABASE_URL'] as const;

/**
 * Recomendadas en producción. Si falta alguna, la feature asociada queda
 * desactivada de forma SEGURA (nunca insegura) y se avisa.
 */
const RECOMMENDED_PROD: Array<{ key: string; feature: string }> = [
  { key: 'WEB_BASE_URL',           feature: 'CORS y enlaces (sin ella se usa localhost)' },
  { key: 'SMTP_HOST',              feature: 'envío de magic links (sin ella, login por email deshabilitado)' },
  { key: 'STRIPE_SECRET_KEY',      feature: 'checkout de pago' },
  { key: 'STRIPE_WEBHOOK_SECRET',  feature: 'activación de premium vía webhook' },
];

export function assertEnv(): void {
  const missing = REQUIRED.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(
      `Faltan variables de entorno obligatorias: ${missing.join(', ')}. ` +
        'La API no arranca sin ellas.'
    );
  }

  if (process.env['NODE_ENV'] === 'production') {
    for (const { key, feature } of RECOMMENDED_PROD) {
      if (!process.env[key]) {
        logger.warn({ key, feature }, `⚠️  ${key} no definida en producción — ${feature}`);
      }
    }
  }
}
