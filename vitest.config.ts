import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    typecheck: {
      enabled: true,
    },
    coverage: {
      provider: 'v8',
      reporter: ['json-summary', 'text', 'lcov'],
      include: ['src'],
      exclude: ['__tests__', '__mocks__', 'src/types'],
    },
    setupFiles: ['__tests__/_setup'],
    include: ['__tests__/**/*.test.ts'],
    forceRerunTriggers: ['**/vitest.config.*/**', '**/__mocks__/**/*', '__tests__/_setup.ts'],
    alias: {
      '@/tests/': `${resolve(__dirname, '__tests__')}/`,
      '@/mocks/': `${resolve(__dirname, '__mocks__')}/`,
      '@/': `${resolve(__dirname, 'src')}/`,
    },
  },
});
