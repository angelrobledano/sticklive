import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  // El alias `@` → src lo resuelve Next en el build, pero vitest tiene su propia
  // resolución: sin esto, un test que carga un módulo con un import de VALOR
  // `@/...` (p. ej. `@/lib/match-time`) falla al resolverlo. Los `import type`
  // no se ven afectados porque el transform los elimina antes de resolver.
  resolve: {
    alias: { '@': resolve(ROOT, 'src') },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
