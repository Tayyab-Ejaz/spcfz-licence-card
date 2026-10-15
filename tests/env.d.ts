/// <reference types="@cloudflare/vitest-plugin/types" />
import type { Env as WorkerEnv } from '../src/types';

// `env` from "cloudflare:test" is typed as Cloudflare.Env. Our bindings live in src/types.ts;
// TEST_MIGRATIONS is added only by vitest.config.ts.
declare global {
  namespace Cloudflare {
    interface Env extends WorkerEnv {
      TEST_MIGRATIONS: import('cloudflare:test').D1Migration[];
    }
  }
}
