import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Mismo alias que tsconfig (tsconfig.json paths): vitest no lee tsconfig, y
// los hooks importan vía '@/src/...' como el resto de la app.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
      'react-native': fileURLToPath(new URL('./src/test-mocks/react-native.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'lib/**/*.test.ts'],
    passWithNoTests: true,
  },
});
