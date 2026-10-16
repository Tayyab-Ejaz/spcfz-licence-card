import { defineConfig } from 'vitest/config';

// Plain Node. Each test file builds its own Env through tests/env.ts (temp SQLite file, temp image
// folder, queue worker disabled, migrations applied), so files can run in parallel.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
