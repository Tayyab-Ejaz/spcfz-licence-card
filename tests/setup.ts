import { applyD1Migrations, env } from 'cloudflare:test';

// Runs once per test file: brings the isolated D1 up to the latest migration.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
