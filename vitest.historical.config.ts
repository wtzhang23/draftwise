import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['scripts/historical-backtest.test.ts'],
    testTimeout: 60_000,
  },
});
