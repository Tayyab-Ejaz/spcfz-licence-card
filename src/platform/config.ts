// Configuration from process.env and an optional .env file (docs/PORT-TO-NODE.md section 2).
// `readConfig` is pure and reports every problem at once; `loadConfig` wraps it for the server entry
// and exits with a clear message when something is missing or malformed.
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { Env, TrustProxy } from '../types.js';
import { TRUST_PROXY_MODES } from '../types.js';

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

/** Host names that only ever reach this machine. Brackets are stripped from IPv6 literals before the lookup. */
const LOOPBACK_NAMES = new Set(['localhost', '127.0.0.1', '::1']);

function isLoopbackName(name: string): boolean {
  return LOOPBACK_NAMES.has(name.trim().toLowerCase().replace(/^\[|\]$/g, ''));
}

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

  // LOCAL_ADMIN_EMAIL opens /admin without sign-in. It is accepted only for a copy that nothing outside this machine
  // can reach; the production container sets HOST=0.0.0.0 and NODE_ENV=production, so it refuses to start with it.
  const localAdminRaw = text(source, 'LOCAL_ADMIN_EMAIL');
  const accessSet = Boolean(text(source, 'ACCESS_TEAM_DOMAIN') || text(source, 'ACCESS_AUD'));
  if (localAdminRaw !== undefined) {
    const local = 'LOCAL_ADMIN_EMAIL is for a local copy only';
    if (!/^[^\s@]+@[^\s@]+$/.test(localAdminRaw)) errors.push(`${local}, and must look like an email address`);
    if (!isLoopbackName(host)) errors.push(`${local}: HOST must be 127.0.0.1, ::1 or localhost, got ${JSON.stringify(host)}`);
    if (baseUrl && !isLoopbackName(new URL(baseUrl).hostname)) errors.push(`${local}: BASE_URL must point at localhost, got ${JSON.stringify(baseUrl)}`);
    if (trustProxy !== 'off') errors.push(`${local}: TRUST_PROXY must be off, got ${JSON.stringify(trustProxy)}`);
    if ((text(source, 'NODE_ENV') ?? '').toLowerCase() === 'production') errors.push(`${local}: NODE_ENV is production`);
    if (accessSet) errors.push(`${local}: unset ACCESS_TEAM_DOMAIN and ACCESS_AUD, or remove LOCAL_ADMIN_EMAIL`);
  }

  const allowlist = text(source, 'ERP_IP_ALLOWLIST') ?? '';
  if (!allowlist) warnings.push('ERP_IP_ALLOWLIST is empty: both intake routes reject every request');
  if (!text(source, 'WEBHOOK_SECRET_CURRENT')) warnings.push('WEBHOOK_SECRET_CURRENT is not set: the production intake route accepts nothing');
  if (!text(source, 'TEST_SECRET_CURRENT')) warnings.push('TEST_SECRET_CURRENT is not set: the test intake route accepts nothing');
  if (localAdminRaw !== undefined) warnings.push(`LOCAL_ADMIN_EMAIL is set: /admin opens without sign-in for browsers on this machine at ${baseUrl}/admin`);
  else if (!text(source, 'ACCESS_TEAM_DOMAIN') || !text(source, 'ACCESS_AUD')) warnings.push('ACCESS_TEAM_DOMAIN / ACCESS_AUD are not set: /admin answers 503');
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
    ACCESS_TEAM_DOMAIN: text(source, 'ACCESS_TEAM_DOMAIN'),
    ACCESS_AUD: text(source, 'ACCESS_AUD'),
    LOCAL_ADMIN_EMAIL: localAdminRaw?.toLowerCase(),
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
