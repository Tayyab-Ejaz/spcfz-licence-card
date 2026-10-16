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

// ------------------------------------------------------------------ platform contracts (R2 subset)

export interface R2HTTPMetadata {
  contentType?: string;
  cacheControl?: string;
}

export interface R2PutOptions {
  httpMetadata?: R2HTTPMetadata;
}

export interface R2Object {
  key: string;
  size: number;
  /** Hex SHA-1 of the content. */
  etag: string;
  /** The same, quoted, ready for an ETag header. */
  httpEtag: string;
  uploaded: Date;
  httpMetadata: R2HTTPMetadata;
}

export interface R2ObjectBody extends R2Object {
  body: ReadableStream<Uint8Array>;
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
}

export type R2PutValue = ArrayBuffer | ArrayBufferView | string | ReadableStream<Uint8Array> | Blob;

export interface R2Bucket {
  put(key: string, value: R2PutValue, options?: R2PutOptions): Promise<R2Object>;
  get(key: string): Promise<R2ObjectBody | null>;
  head(key: string): Promise<R2Object | null>;
  delete(keys: string | string[]): Promise<void>;
  list(options?: { prefix?: string }): Promise<{ objects: R2Object[]; truncated: false }>;
}

// ------------------------------------------------------------------ platform contracts (Queue subset)

export interface Queue<T> {
  send(body: T): Promise<void>;
}

export interface Message<T> {
  readonly id: string;
  readonly timestamp: Date;
  readonly body: T;
  /** 1 on first delivery. */
  readonly attempts: number;
  ack(): void;
  retry(options?: { delaySeconds?: number }): void;
}

export interface MessageBatch<T> {
  readonly queue: string;
  readonly messages: readonly Message<T>[];
  ackAll(): void;
  retryAll(options?: { delaySeconds?: number }): void;
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
  BUCKET: R2Bucket;
  RENDER_QUEUE: Queue<RenderJob>;

  /** All state lives here: the SQLite file, images/, backups/, the Cloudflare range cache. */
  DATA_DIR: string;
  PORT: number;
  TRUST_PROXY: TrustProxy;

  BASE_URL: string;
  ERP_IP_ALLOWLIST: string;
  FIELD_MAP: string;
  GTM_CONTAINER: string;
  TEMPLATE_VERSION: string;

  WEBHOOK_SECRET_CURRENT?: string;
  WEBHOOK_SECRET_PREVIOUS?: string;
  TEST_SECRET_CURRENT?: string;
  TEST_SECRET_PREVIOUS?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  /** Chromium executable for the renderer; puppeteer's own download when unset. */
  CHROME_PATH?: string;
}

/** Hono generic: every router in src/ is a `Hono<AppEnv>`. */
export type AppEnv = {
  Bindings: Env;
  Variables: {
    /** Set by the admin middleware after Cloudflare Access verification. */
    actor?: string;
    /** Per-request nonce for inline scripts under the page CSP. */
    nonce?: string;
  };
};

export type Lang = 'en' | 'ar';
export const LANGS: readonly Lang[] = ['en', 'ar'] as const;

export type Size = 'square' | 'portrait' | 'story' | 'landscape';
export const SIZES: Readonly<Record<Size, { width: number; height: number }>> = {
  square: { width: 1080, height: 1080 },
  portrait: { width: 1080, height: 1350 },
  story: { width: 1080, height: 1920 },
  landscape: { width: 1200, height: 628 },
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
  status: CardStatus;
  render_error: string | null;
  source: CardSource;
  template_version: string | null;
  created_at: string;
  updated_at: string;
  rendered_at: string | null;
  expires_at: string | null;
}

export type IntakeRoute = 'production' | 'test';
export type EventRoute = IntakeRoute | 'admin';
export type EventOutcome =
  | 'created' | 'unchanged' | 'updated' | 'rejected'
  | 'replayed' | 'regenerated' | 'deleted' | 'expired' | 'imported' | 'settings' | 'rerender';

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

export interface RenderJob {
  card_id: string;
  content_hash: string;
}

/** What `upsertFromCanonical` reports back. */
export type UpsertOutcome = 'created' | 'unchanged' | 'updated';

export const SETTING_KEYS = [
  'caption_en', 'caption_ar', 'gtm_enabled', 'retention_days', 'test_retention_days', 'raw_body_days',
] as const;
export type SettingKey = (typeof SETTING_KEYS)[number];
