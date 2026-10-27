// Configuration from process.env and an optional .env file (docs/PORT-TO-NODE.md section 2).
// `readConfig` is pure and reports every problem at once; `loadConfig` wraps it for the server entry
// and exits with a clear message when something is missing or malformed.
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { Env, TrustProxy } from '../types.js';
import { MAIL_TRANSPORT_MODES, TRUST_PROXY_MODES } from '../types.js';
import type { MailTransportMode } from '../types.js';

/** The part of Env that comes from configuration rather than from an adapter. */
export type EnvVars = Omit<Env, 'DB' | 'BUCKET' | 'RENDER_QUEUE'>;

export interface ServerConfig {
  vars: EnvVars;
  /** Interface to bind. 127.0.0.1 by default; 0.0.0.0 inside the container, where Docker publishes the port to loopback. */
  host: string;
  port: number;
  dataDir: string;
  trustProxy: TrustProxy;
  /** Which .env file was merged, if any. */
  envFile: string | null;
  warnings: string[];
}

export type ConfigSource = Record<string, string | undefined>;

export const DEFAULT_PORT = 8787;
export const DEFAULT_HOST = '127.0.0.1';
export const DEFAULT_TRUST_PROXY: TrustProxy = 'local-proxy';


/**
 * Minimal .env parser: `KEY=value` per line, `#` comments, blank lines, optional `export `, optional
 * single or double quotes around the value (double quotes understand \n). No interpolation.
 */
export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1]!;
    let value = m[2]!.trim();
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1).replace(/\\n/g, '\n').replace(/\\"/g, '"');
    } else if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    } else {
      const hash = value.indexOf(' #');
      if (hash >= 0) value = value.slice(0, hash).trim();
    }
    out[key] = value;
  }
  return out;
}

function text(source: ConfigSource, key: string): string | undefined {
  const v = source[key];
  if (v === undefined) return undefined;
  const t = v.trim();
  return t === '' ? undefined : t;
}

export type ConfigResult = { ok: true; config: ServerConfig } | { ok: false; errors: string[] };

export function readConfig(source: ConfigSource, envFile: string | null = null): ConfigResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // BASE_URL
  const baseUrlRaw = text(source, 'BASE_URL');
  let baseUrl = '';
  if (!baseUrlRaw) errors.push('BASE_URL is required (e.g. https://licensed.spcfz.ae)');
  else {
    try {
      const u = new URL(baseUrlRaw);
      if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('scheme');
      baseUrl = baseUrlRaw.replace(/\/+$/, '');
    } catch {
      errors.push(`BASE_URL must be an http(s) URL, got ${JSON.stringify(baseUrlRaw)}`);
    }
  }

  // DATA_DIR
  const dataDirRaw = text(source, 'DATA_DIR');
  let dataDir = '';
  if (!dataDirRaw) errors.push('DATA_DIR is required (the folder that holds the SQLite file and the images)');
  else {
    dataDir = path.resolve(dataDirRaw);
    if (existsSync(dataDir) && !statSync(dataDir).isDirectory()) errors.push(`DATA_DIR ${dataDir} exists and is not a directory`);
  }

  // PORT
  const portRaw = text(source, 'PORT');
  let port = DEFAULT_PORT;
  if (portRaw !== undefined) {
    if (!/^\d{1,5}$/.test(portRaw) || Number(portRaw) > 65535) errors.push(`PORT must be an integer between 0 and 65535, got ${JSON.stringify(portRaw)}`);
    else port = Number(portRaw);
  }

  // HOST
  const host = text(source, 'HOST') ?? DEFAULT_HOST;

  // TRUST_PROXY
  const trustRaw = text(source, 'TRUST_PROXY');
  let trustProxy: TrustProxy = DEFAULT_TRUST_PROXY;
  if (trustRaw !== undefined) {
    const lower = trustRaw.toLowerCase();
    if ((TRUST_PROXY_MODES as readonly string[]).includes(lower)) trustProxy = lower as TrustProxy;
    else errors.push(`TRUST_PROXY must be one of ${TRUST_PROXY_MODES.join(', ')}, got ${JSON.stringify(trustRaw)}`);
  }

  // FIELD_MAP must at least be a JSON object; the mapper would silently ignore anything else.
  const fieldMap = text(source, 'FIELD_MAP') ?? '{}';
  try {
    const parsed: unknown = JSON.parse(fieldMap);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('not an object');
  } catch {
    errors.push('FIELD_MAP must be a JSON object mapping ERP field names to canonical names');
  }

  // ADMIN_LOGIN_KEY opens the staff sign-in page (/admin/login?key=...). Short keys are refused outright.
  const loginKey = text(source, 'ADMIN_LOGIN_KEY');
  if (loginKey !== undefined && loginKey.length < 24) errors.push('ADMIN_LOGIN_KEY must be at least 24 characters (it is the only way to reach the sign-in page)');

  // Mail: smtp needs a URL and a sender; file and off need nothing.
  const smtpUrl = text(source, 'MAIL_SMTP_URL');
  const modeRaw = text(source, 'MAIL_TRANSPORT')?.toLowerCase();
  let mailMode: MailTransportMode = smtpUrl ? 'smtp' : 'off';
  if (modeRaw !== undefined) {
    if ((MAIL_TRANSPORT_MODES as readonly string[]).includes(modeRaw)) mailMode = modeRaw as MailTransportMode;
    else errors.push(`MAIL_TRANSPORT must be one of ${MAIL_TRANSPORT_MODES.join(', ')}, got ${JSON.stringify(modeRaw)}`);
  }
  const mailFrom = text(source, 'MAIL_FROM');
  if (mailMode === 'smtp') {
    if (!smtpUrl) errors.push('MAIL_TRANSPORT=smtp needs MAIL_SMTP_URL (smtp(s)://user:password@host:port)');
    else if (!/^smtps?:\/\//i.test(smtpUrl)) errors.push('MAIL_SMTP_URL must start with smtp:// or smtps://');
    if (!mailFrom) errors.push('MAIL_TRANSPORT=smtp needs MAIL_FROM, e.g. "SPC Free Zone <license@spcfz.ae>"');
  }
  if (mailMode === 'off') warnings.push('MAIL_TRANSPORT=off: welcome emails are queued in the admin but not sent');
  const liId = text(source, 'LINKEDIN_CLIENT_ID');
  const liSecret = text(source, 'LINKEDIN_CLIENT_SECRET');
  if (Boolean(liId) !== Boolean(liSecret)) errors.push('LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET go together');
  const liFake = text(source, 'LINKEDIN_FAKE') === '1' ? '1' : undefined;
  if (liFake && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(baseUrl ?? '')) errors.push('LINKEDIN_FAKE=1 is for the local copy only (BASE_URL must be http://localhost)');
  if (!liId && !liFake) warnings.push('LINKEDIN_CLIENT_ID is not set: the "Post to LinkedIn" button is hidden');
  if (liFake) warnings.push('LINKEDIN_FAKE=1: "Post to LinkedIn" uses a pretend LinkedIn and writes posts to DATA_DIR/linkedin-outbox');
  const liVersion = text(source, 'LINKEDIN_API_VERSION');
  if (liVersion !== undefined && !/^20\d{4}$/.test(liVersion)) errors.push('LINKEDIN_API_VERSION must look like 202606 (YYYYMM)');

  const allowlist = text(source, 'ERP_IP_ALLOWLIST') ?? '';
  if (!allowlist) warnings.push('ERP_IP_ALLOWLIST is empty: both intake routes reject every request');
  if (!text(source, 'WEBHOOK_SECRET_CURRENT')) warnings.push('WEBHOOK_SECRET_CURRENT is not set: the production intake route accepts nothing');
  if (!text(source, 'TEST_SECRET_CURRENT')) warnings.push('TEST_SECRET_CURRENT is not set: the test intake route accepts nothing');
  if (loginKey === undefined) warnings.push('ADMIN_LOGIN_KEY is not set: the admin sign-in page is closed and /admin answers 404');
  if (trustProxy === 'off') warnings.push('TRUST_PROXY=off: the socket peer is taken as the client address; only for local use');

  if (errors.length) return { ok: false, errors };

  const vars: EnvVars = {
    DATA_DIR: dataDir,
    PORT: port,
    TRUST_PROXY: trustProxy,
    BASE_URL: baseUrl,
    ERP_IP_ALLOWLIST: allowlist,
    FIELD_MAP: fieldMap,
    GTM_CONTAINER: text(source, 'GTM_CONTAINER') ?? '',
    WEBHOOK_SECRET_CURRENT: text(source, 'WEBHOOK_SECRET_CURRENT'),
    WEBHOOK_SECRET_PREVIOUS: text(source, 'WEBHOOK_SECRET_PREVIOUS'),
    TEST_SECRET_CURRENT: text(source, 'TEST_SECRET_CURRENT'),
    TEST_SECRET_PREVIOUS: text(source, 'TEST_SECRET_PREVIOUS'),
    ADMIN_LOGIN_KEY: loginKey,
    MAIL_TRANSPORT: mailMode,
    MAIL_SMTP_URL: smtpUrl,
    MAIL_FROM: mailFrom,
    MAIL_REPLY_TO: text(source, 'MAIL_REPLY_TO'),
    MAIL_BCC: text(source, 'MAIL_BCC'),
    MAIL_TEST_ALLOWLIST: text(source, 'MAIL_TEST_ALLOWLIST'),
    LINKEDIN_CLIENT_ID: liId,
    LINKEDIN_CLIENT_SECRET: liSecret,
    LINKEDIN_ORG_URN: text(source, 'LINKEDIN_ORG_URN'),
    LINKEDIN_API_VERSION: liVersion,
    LINKEDIN_FAKE: liFake,
  };
  return { ok: true, config: { vars, host, port, dataDir, trustProxy, envFile, warnings } };
}

export interface LoadConfigOptions {
  /** Path of the .env file to merge under process.env. Default: $ENV_FILE, else ./.env when it exists. */
  envFile?: string;
  source?: ConfigSource;
  /** For tests: called instead of process.exit. */
  exit?: (code: number) => never;
  stderr?: (line: string) => void;
}

/** process.env (plus an optional .env file, which never overrides a real variable) validated, or exit(1). */
export function loadConfig(options: LoadConfigOptions = {}): ServerConfig {
  const base: ConfigSource = options.source ?? process.env;
  const exit = options.exit ?? ((code: number): never => process.exit(code));
  const stderr = options.stderr ?? ((line: string): void => console.error(line));

  const envFile = options.envFile ?? base['ENV_FILE'] ?? path.resolve(process.cwd(), '.env');
  let merged: ConfigSource = { ...base };
  let used: string | null = null;
  if (envFile && existsSync(envFile)) {
    const fromFile = parseEnvFile(readFileSync(envFile, 'utf8'));
    merged = { ...fromFile, ...Object.fromEntries(Object.entries(base).filter(([, v]) => v !== undefined)) };
    used = envFile;
  }

  const result = readConfig(merged, used);
  if (!result.ok) {
    stderr('spcfz-licence-card: configuration is not usable');
    for (const e of result.errors) stderr(`  - ${e}`);
    stderr('Set the variables in the environment or in a .env file (see deploy/licence-card.env.example).');
    return exit(1);
  }
  return result.config;
}
