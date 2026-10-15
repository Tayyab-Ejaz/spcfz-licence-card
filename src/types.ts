// Shared types. docs/ARCHITECTURE.md is the contract; this file is its TypeScript shadow.

export interface Env {
  DB: D1Database;
  BUCKET: R2Bucket;
  RENDER_QUEUE: Queue<RenderJob>;
  BROWSER: Fetcher;

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
