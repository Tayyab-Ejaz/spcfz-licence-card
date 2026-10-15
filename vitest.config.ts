import path from 'node:path';
import { defineConfig } from 'vitest/config';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';

// Vitest 4 shape: the Workers pool is a Vite plugin; test bindings are passed through `miniflare.bindings`.
export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(import.meta.dirname, 'migrations'));
  return {
    plugins: [
      cloudflareTest({
        // The `test` environment has no queue consumers and no browser binding (see wrangler.toml).
        wrangler: { configPath: './wrangler.toml', environment: 'test' },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            ERP_IP_ALLOWLIST: '203.0.113.10,198.51.100.0/24',
            FIELD_MAP: '{}',
            BASE_URL: 'https://licensed.test',
            WEBHOOK_SECRET_CURRENT: 'test-production-secret-current',
            WEBHOOK_SECRET_PREVIOUS: 'test-production-secret-previous',
            TEST_SECRET_CURRENT: 'test-test-secret-current',
            TEST_SECRET_PREVIOUS: '',
            ACCESS_TEAM_DOMAIN: 'spcfz-test',
            ACCESS_AUD: 'test-audience',
            GTM_CONTAINER: '',
            TEMPLATE_VERSION: 'placeholder-1',
          },
        },
      }),
    ],
    test: {
      setupFiles: ['./tests/setup.ts'],
      include: ['tests/**/*.test.ts'],
    },
  };
});
