/**
 * Tests de integración: Postgres real, migraciones reales.
 *
 * Va aparte de los `vitest.config.ts` de cada workspace a propósito. Los tests
 * unitarios tienen que seguir corriendo en segundos y sin dependencias — si
 * mezclas ambos, o los unitarios pasan a necesitar una base, o los de
 * integración se saltan en silencio. Ninguna de las dos cosas es aceptable.
 *
 *   docker compose -f docker-compose.test.yml up -d
 *   npm run test:integration
 */
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    // Alias explícitos en vez de fiarlo a los symlinks de node_modules.
    // Los workspaces de npm se enlazan con symlinks, y eso se rompe según el
    // sistema de ficheros (montajes de Windows en Linux, por ejemplo). Con
    // alias, resolver es determinista en cualquier entorno.
    alias: {
      '@sports/db': resolve(ROOT, 'packages/db/src/index.ts'),
      '@sports/logger': resolve(ROOT, 'packages/logger/src/index.ts'),
      '@sports/shared-types': resolve(ROOT, 'packages/shared-types/src/index.ts'),
      '@sports/analytics': resolve(ROOT, 'packages/analytics/src/index.ts'),
    },
  },
  test: {
    include: ['tests/integration/**/*.integration.test.ts'],
    globalSetup: ['tests/integration/support/global-setup.ts'],
    // En serie: todos los tests comparten una única base y `limpiar()` hace
    // TRUNCATE de todo. En paralelo se borrarían los datos unos a otros.
    fileParallelism: false,
    // Migrar desde cero la primera vez lleva su rato.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
