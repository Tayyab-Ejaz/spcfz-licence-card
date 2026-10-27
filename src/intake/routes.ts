// Intake router: POST /v1/licence-issued (production) and POST /v1/test/licence-issued (test).
// Checks run in the order of ARCHITECTURE section 4: IP, secret, size and shape, mapped-field validation, upsert.
// Every request writes one events row. The test route also keeps the raw body for a few days (C4);
// the production route never does.
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { AppEnv, CardSource, Env, EventOutcome, IntakeRoute } from '../types.js';
import { insertEvent } from '../db/cards.js';
import { queueWelcome } from '../mail/outbox.js';

import { checkIp, checkSecret, extractSecret } from './auth.js';
import { isPlainObject } from './common.js';
import { mapPayload } from './mapper.js';
import { upsertFromCanonical } from './upsert.js';
import { validateCanonical } from './validate.js';

export const MAX_BODY_BYTES = 65536;
export const PRODUCTION_PATH = '/v1/licence-issued';
export const TEST_PATH = '/v1/test/licence-issued';

const NO_STORE: Record<string, string> = { 'Cache-Control': 'no-store' };

type RejectStatus = 400 | 401 | 403 | 413;

interface RouteConfig {
  route: IntakeRoute;
  source: CardSource;
  is_test: boolean;
  /** The test route keeps the raw body on every event once the caller has authenticated. */
  keepRawBody: boolean;
  secrets: (env: Env) => { current: string | undefined; previous: string | undefined };
}

const PRODUCTION: RouteConfig = {
  route: 'production',
  source: 'webhook',
  is_test: false,
  keepRawBody: false,
  secrets: (env) => ({ current: env.WEBHOOK_SECRET_CURRENT, previous: env.WEBHOOK_SECRET_PREVIOUS }),
};

const TEST: RouteConfig = {
  route: 'test',
  source: 'test',
  is_test: true,
  keepRawBody: true,
  secrets: (env) => ({ current: env.TEST_SECRET_CURRENT, previous: env.TEST_SECRET_PREVIOUS }),
};

/**
 * Read the body as UTF-8 text, stopping after `max` bytes. `tooLarge` is true when the body went past
 * the cap; `text` then holds the first `max` bytes, which is what the test route stores for a 413.
 */
async function readBodyCapped(req: Request, max: number): Promise<{ text: string; tooLarge: boolean }> {
  const body = req.body;
  if (!body) return { text: '', tooLarge: false };
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let received = 0;
  let tooLarge = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      const chunk: Uint8Array = value;
      received += chunk.byteLength;
      if (received > max) {
        tooLarge = true;
        const keep = chunk.byteLength - (received - max);
        text += decoder.decode(chunk.subarray(0, keep), { stream: true });
        break;
      }
      text += decoder.decode(chunk, { stream: true });
    }
  } finally {
    if (tooLarge) await reader.cancel().catch(() => undefined);
    else reader.releaseLock();
  }
  text += decoder.decode();
  return { text, tooLarge };
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function declaredLengthExceeds(header: string | undefined, max: number): boolean {
  if (header === undefined) return false;
  const trimmed = header.trim();
  return /^\d+$/.test(trimmed) && Number(trimmed) > max;
}

function makeHandler(cfg: RouteConfig) {
  return async (c: Context<AppEnv>): Promise<Response> => {
    const env = c.env;
    const db = env.DB;
    const ipHeader = c.req.header('CF-Connecting-IP');
    const sourceIp = ipHeader?.trim() || 'unknown';

    // Set once the body has been read. Only ever persisted on the test route.
    let rawBody: string | null = null;

    const record = async (
      http_status: number, outcome: EventOutcome, errors: string[] | null, card_id: string | null,
    ): Promise<void> => {
      let raw_body: string | null = null;
      const raw_body_expires_at: string | null = null;
      if (cfg.keepRawBody && rawBody !== null) {
        // Kept for good since 19 October 2026 (no data is deleted); raw_body_expires_at stays NULL.
        raw_body = rawBody.slice(0, MAX_BODY_BYTES);
      }
      await insertEvent(db, {
        route: cfg.route, source_ip: sourceIp, http_status, outcome, errors, card_id, raw_body, raw_body_expires_at,
      });
    };

    const reject = async (status: RejectStatus, errors: string[]): Promise<Response> => {
      await record(status, 'rejected', errors, null);
      console.log('intake rejected', { route: cfg.route, status, errors });
      return c.json({ status: 'rejected', errors }, status, NO_STORE);
    };

    try {
      // 1. Source IP.
      if (!checkIp(ipHeader, env.ERP_IP_ALLOWLIST)) return await reject(403, ['source address not allowed']);

      // 2. Shared secret for this route.
      const { current, previous } = cfg.secrets(env);
      if (!(await checkSecret(extractSecret(c.req.raw.headers), current, previous))) {
        return await reject(401, ['invalid secret']);
      }

      // 3. Size and shape.
      if (declaredLengthExceeds(c.req.header('Content-Length'), MAX_BODY_BYTES)) {
        return await reject(413, [`body exceeds ${MAX_BODY_BYTES} bytes`]);
      }
      const body = await readBodyCapped(c.req.raw, MAX_BODY_BYTES);
      rawBody = body.text;
      if (body.tooLarge) return await reject(413, [`body exceeds ${MAX_BODY_BYTES} bytes`]);
      const payload = parseJsonObject(body.text);
      if (payload === null) return await reject(400, ['body is not a JSON object']);

      // 4. Map, then validate.
      const validated = validateCanonical(mapPayload(payload, env.FIELD_MAP));
      if (!validated.ok) return await reject(400, validated.errors);

      // 5. Create or update the card.
      const result = await upsertFromCanonical(env, validated.fields, { is_test: cfg.is_test, source: cfg.source });
      await record(200, result.outcome, null, result.card.id);
      // 6. The welcome email, once per card (src/mail/outbox.ts). A mail problem never fails the webhook.
      if (result.outcome !== 'unchanged') {
        try {
          await queueWelcome(env, result.card, { actor: null });
        } catch (err) {
          console.error('welcome email not queued', { card_id: result.card.id, message: err instanceof Error ? err.message : String(err) });
        }
      }
      console.log('intake accepted', {
        route: cfg.route, outcome: result.outcome, licence_number: result.card.licence_number, card_id: result.card.id,
      });
      return c.json(
        { status: 'accepted', card_id: result.card.id, page_url: result.page_url, ready: result.card.status === 'ready' },
        200,
        NO_STORE,
      );
    } catch (err) {
      console.error('intake failed', { route: cfg.route, message: err instanceof Error ? err.message : 'unknown error' });
      try {
        await record(500, 'rejected', ['internal error'], null);
      } catch {
        // The event log is best effort here; the client still gets its 500.
      }
      return c.json({ status: 'error' }, 500, NO_STORE);
    }
  };
}

const methodNotAllowed = (c: Context<AppEnv>): Response =>
  c.json({ status: 'rejected', errors: ['method not allowed'] }, 405, { ...NO_STORE, Allow: 'POST' });

export const intakeRoutes = new Hono<AppEnv>();

intakeRoutes.post(PRODUCTION_PATH, makeHandler(PRODUCTION));
intakeRoutes.post(TEST_PATH, makeHandler(TEST));
intakeRoutes.on(['GET', 'HEAD', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'], [PRODUCTION_PATH, TEST_PATH], methodNotAllowed);
