import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: [
      '__tests__/**/*.test.ts',
      'src/**/*.test.ts',
    ],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/*.spec.ts',
    ],
    coverage: {
      reporter: ['text', 'json-summary'],
    },
  },
});
