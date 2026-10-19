// Shared types. docs/ARCHITECTURE.md is the contract; this file is its TypeScript shadow.
//
// The service runs on Node (docs/PORT-TO-NODE.md). The three platform bindings keep the shape of the
// Cloudflare APIs the application code was written against, implemented by the adapters in src/platform:
// a D1-shaped SQLite database, an R2-shaped filesystem bucket and a Queue-shaped SQLite job table.

// ------------------------------------------------------------------ platform contracts (D1 subset)

export interface D1Meta {
  changes: number;
  last_row_id: number;
  duration: number;
  rows_read: number;
  rows_written: number;
}

export interface D1Result<T = Record<string, unknown>> {
  results: T[];
  success: true;
  meta: D1Meta;
}

export interface D1ExecResult {
  count: number;
  duration: number;
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  /** The first row, or null when the statement returns none. With a column name, that column of the first row. */
  first<T = Record<string, unknown>>(): Promise<T | null>;
  first<T = unknown>(column: string): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
}

export interface D1Database {
  prepare(sql: string): D1PreparedStatement;
  /** Runs every statement in one transaction; results come back in the same order. */
  batch<T = Record<string, unknown>>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
  /** Runs one or more semicolon-separated statements with no parameters. */
  exec(sql: string): Promise<D1ExecResult>;
}

// ------------------------------------------------------------------ Env

/**
 * How the client address is established (docs/PORT-TO-NODE.md section 5).
 * `off`: the socket peer is the client; `CF-Connecting-IP` is ignored. Local development and tests.
 * `cloudflare`: `CF-Connecting-IP` is trusted only when the socket peer is a Cloudflare address.
 * `local-proxy`: `CF-Connecting-IP` is trusted only when the socket peer is loopback or a private address,
 *   that is a reverse proxy on the same host which has already enforced Cloudflare-only. Production.
 */
export type TrustProxy = 'off' | 'cloudflare' | 'local-proxy';
export const TRUST_PROXY_MODES: readonly TrustProxy[] = ['off', 'cloudflare', 'local-proxy'] as const;

export interface Env {
  DB: D1Database;

  /** All state lives here: the SQLite file, backups/, the Cloudflare range cache. */
  DATA_DIR: string;
  PORT: number;
  TRUST_PROXY: TrustProxy;

  BASE_URL: string;
  ERP_IP_ALLOWLIST: string;
  FIELD_MAP: string;
  GTM_CONTAINER: string;

  WEBHOOK_SECRET_CURRENT?: string;
  WEBHOOK_SECRET_PREVIOUS?: string;
  TEST_SECRET_CURRENT?: string;
  TEST_SECRET_PREVIOUS?: string;
  /**
   * Opens the staff sign-in page: it exists only at /admin/login?key=<this>. At least 24 characters; when missing,
   * sign-in is closed and every /admin address answers 404 (src/admin/auth.ts).
   */
  ADMIN_LOGIN_KEY?: string;
}

/** Hono generic: every router in src/ is a `Hono<AppEnv>`. */
export type AppEnv = {
  Bindings: Env;
  Variables: {
    /** Set by the admin middleware: the signed-in staff member's email (src/admin/auth.ts). */
    actor?: string;
    /** Per-request nonce for inline scripts under the page CSP. */
    nonce?: string;
  };
};

export type Lang = 'en' | 'ar';
export const LANGS: readonly Lang[] = ['en', 'ar'] as const;

/** The studio's export formats (the customer picks one; it is reported with download and share counters). */
export type Size = 'square' | 'portrait' | 'landscape';
export const SIZES: Readonly<Record<Size, { width: number; height: number }>> = {
  square: { width: 1080, height: 1080 },
  portrait: { width: 1080, height: 1350 },
  landscape: { width: 1200, height: 627 },
};
export const SIZE_NAMES = Object.keys(SIZES) as Size[];

export function isLang(v: unknown): v is Lang {
  return v === 'en' || v === 'ar';
}
export function isSize(v: unknown): v is Size {
  return typeof v === 'string' && v in SIZES;
}

/** The only fields the service keeps about a licence. Everything else is dropped on receipt. */
export interface CanonicalFields {
  licence_number: string;        // trimmed, uppercased
  company_name_en: string;
  company_name_ar: string | null;
  licence_type: string | null;
  activity_category: string | null;
  activity_category_ar: string | null;  // Arabic card uses it; falls back to activity_category
  founder_name_en: string | null;       // pre-filled on the card; personal data, deleted with the card
  founder_name_ar: string | null;       // Arabic card uses it; falls back to founder_name_en
  issued_on: string;             // YYYY-MM-DD
  preferred_language: Lang;
}

export type CardStatus = 'pending' | 'ready' | 'failed' | 'expired';
export type CardSource = 'webhook' | 'test' | 'manual' | 'csv' | 'replay';

export interface CardRow extends CanonicalFields {
  id: string;                    // ULID
  token: string;                 // 22-char base62
  is_test: boolean;
  content_hash: string;
  status: CardStatus;            // 'ready' from creation; 'pending' and 'failed' only on rows from the server-render era
  render_error: string | null;   // legacy, always null now
  source: CardSource;
  template_version: string | null; // legacy, always null now
  created_at: string;
  updated_at: string;
  rendered_at: string | null;
  expires_at: string | null;
}

export type IntakeRoute = 'production' | 'test';
export type EventRoute = IntakeRoute | 'admin';
export type EventOutcome =
  | 'created' | 'unchanged' | 'updated' | 'rejected'
  | 'replayed' | 'deleted' | 'expired' | 'unexpired' | 'imported' | 'settings'
  | 'regenerated' | 'rerender';  // the last two only on rows from the server-render era

export interface EventRow {
  id: string;
  received_at: string;
  route: EventRoute;
  source_ip: string;
  http_status: number;
  outcome: EventOutcome;
  errors: string[] | null;
  card_id: string | null;
  raw_body: string | null;
  raw_body_expires_at: string | null;
  actor: string | null;
}

export type MetricKind = 'view' | 'download' | 'share' | 'caption';

/** What `upsertFromCanonical` reports back. */
export type UpsertOutcome = 'created' | 'unchanged' | 'updated';

export const SETTING_KEYS = ['gtm_enabled', 'retention_days', 'test_retention_days', 'raw_body_days'] as const;
export type SettingKey = (typeof SETTING_KEYS)[number];
