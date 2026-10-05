import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'lib/**/*.test.ts'],
    // Todavía no hay tests (llegan en Task 1.2+); no tratarlo como fallo.
    passWithNoTests: true,
  },
});
