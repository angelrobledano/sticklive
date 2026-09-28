import pino from 'pino';

const isDev = process.env['NODE_ENV'] !== 'production';

// LOG_FORMAT (json|pretty) fuerza el formato con independencia del entorno; si
// no está definido: pretty en desarrollo y JSON en producción (#333).
const format = process.env['LOG_FORMAT'];
const pretty = format ? format === 'pretty' : isDev;

export const logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  ...(pretty
    ? {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
        },
      }
    : {}),
  formatters: {
    level(label) {
      return { level: label };
    },
  },
  base: {
    service: process.env['SERVICE_NAME'] ?? 'sports-platform',
  },
});

export type Logger = typeof logger;

/**
 * Crea un logger hijo con contexto adicional.
 * Uso: const log = createLogger({ scraper: 'fep_hockey', entity: 'competition' })
 */
export function createLogger(context: Record<string, unknown>): Logger {
  return logger.child(context) as Logger;
}
