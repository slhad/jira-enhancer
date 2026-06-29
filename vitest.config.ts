import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['__tests__/**/*.test.ts', 'src/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.spec.ts'],
    coverage: {
      all: false,
      reporter: ['text', 'json-summary'],
      thresholds: {
        lines: 90,
        branches: 90,
        functions: 90,
        statements: 90,
      },
      exclude: [
        '**/node_modules/**',
        '**/dist/**',
        '**/__tests__/**',
        '**/*.d.ts',
        '**/src/index.ts',
        '**/src/**/*.test.ts',
        '**/src/popup/main.tsx',
        '**/src/config-types.ts',
        '**/src/jira-types.ts',
        '**/src/protocol.ts',
        '**/src/debug-logger.ts',
        '**/src/llm/pi-adapter.ts',
        '**/src/llm/opencode-adapter.ts',
      ],
    },
  },
});
