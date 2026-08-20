import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Resolves the "@/*" alias from tsconfig so tests import modules exactly
    // the way application code does.
    tsconfigPaths: true,
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
