import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    typecheck: {
      enabled: true,
    },
    coverage: {
      provider: 'v8',
      reporter: ['json-summary', 'text', 'lcov'],
      include: ['src'],
      exclude: ['**/__tests__/**/*', '**/__mocks__/**/*'],
    },
    setupFiles: ['__tests__/setup.ts'],
  },
});
