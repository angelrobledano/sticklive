import pino from 'pino';

const isDev = process.env['NODE_ENV'] !== 'production';

export const logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  ...(isDev
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
