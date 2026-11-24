// How a WhatsApp message leaves the service. gallabox: Gallabox's API (SPC's WhatsApp Business account; replies land
// in Gallabox's inbox, where the team already works). file: each message is written to DATA_DIR/whatsapp-outbox as
// .json (the request, without keys) and .txt (the message as the customer reads it), for the local copy. off: nothing
// is sent and messages stay queued.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Env, WhatsappTransportMode } from '../types.js';
import { TEMPLATE_TEXT, gallaboxTemplateBody } from './message.js';
import type { WelcomeWhatsapp } from './message.js';

export const DEFAULT_GALLABOX_API = 'https://server.gallabox.com/devapi';

export interface OutgoingWhatsapp {
  to: string;
  name: string;
  message: WelcomeWhatsapp;
}

/** Gallabox's answer about one message: WhatsApp's own status and, when it failed, why. */
export interface DeliveryReport {
  status: string;
  at: string | null;
  error: string | null;
}

export interface WhatsappTransport {
  readonly mode: 'gallabox' | 'file';
  send(m: OutgoingWhatsapp): Promise<{ id: string }>;
  /** What WhatsApp says about a sent message; null when this transport cannot tell (the local copy, no account id). */
  delivery(providerId: string): Promise<DeliveryReport | null>;
}

/** An error worth showing staff: Gallabox's own message, never the request's keys. */
export class GallaboxError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function errorText(status: number, body: string): string {
  let detail = body.trim().slice(0, 300);
  try {
    const j = JSON.parse(body) as { message?: unknown; error?: unknown; errors?: unknown };
    const m = j.message ?? j.error ?? j.errors;
    if (m !== undefined) detail = (typeof m === 'string' ? m : JSON.stringify(m)).slice(0, 300);
  } catch { /* not JSON: keep the text */ }
  return `Gallabox answered ${status}${detail ? `: ${detail}` : ''}`;
}

/** WhatsApp gives times as seconds since 1970 ("1722247579") or ISO; we keep ISO. */
function isoTime(v: unknown): string | null {
  if (typeof v === 'string' && /^\d{9,11}$/.test(v)) return new Date(Number(v) * 1000).toISOString();
  if (typeof v === 'number' && Number.isFinite(v)) return new Date(v * 1000).toISOString();
  if (typeof v === 'string' && !Number.isNaN(Date.parse(v))) return new Date(v).toISOString();
  return null;
}

/** Gallabox's status answer (GET /accounts/:accountId/messages/:messageId/status) as a report. */
export function readDelivery(j: unknown): DeliveryReport | null {
  if (!j || typeof j !== 'object') return null;
  const o = j as { status?: unknown; timestamp?: unknown; errors?: unknown };
  if (typeof o.status !== 'string' || !o.status) return null;
  let error: string | null = null;
  if (Array.isArray(o.errors) && o.errors.length) {
    const e = o.errors[0] as { code?: unknown; title?: unknown; message?: unknown; error_data?: { details?: unknown } };
    const words = [e.title ?? e.message, e.error_data?.details].filter((x) => typeof x === 'string' && x).join(': ');
    error = `WhatsApp: ${words || 'not delivered'}${e.code !== undefined ? ` (${String(e.code)})` : ''}`;
  }
  return { status: o.status.toLowerCase(), at: isoTime(o.timestamp), error };
}

/** The transport the configuration asks for, or null when WhatsApp is off. `fetchImpl` stands in for the network in tests. */
export function whatsappTransportFromEnv(env: Env, fetchImpl: typeof fetch = fetch): WhatsappTransport | null {
  const mode: WhatsappTransportMode = env.WHATSAPP_TRANSPORT ?? (env.GALLABOX_API_KEY ? 'gallabox' : 'off');
  if (mode === 'gallabox' && env.GALLABOX_API_KEY && env.GALLABOX_API_SECRET && env.GALLABOX_CHANNEL_ID) {
    const api = (env.GALLABOX_API_URL || DEFAULT_GALLABOX_API).replace(/\/+$/, '');
    const headers = { apiKey: env.GALLABOX_API_KEY, apiSecret: env.GALLABOX_API_SECRET, 'Content-Type': 'application/json', Accept: 'application/json' };
    const channelId = env.GALLABOX_CHANNEL_ID;
    const accountId = env.GALLABOX_ACCOUNT_ID;
    return {
      mode: 'gallabox',
      async send(m) {
        const res = await fetchImpl(`${api}/messages/whatsapp`, {
          method: 'POST',
          headers,
          body: JSON.stringify(gallaboxTemplateBody(m.message, { channelId, phone: m.to, name: m.name })),
          signal: AbortSignal.timeout(20_000),
        });
        const text = await res.text();
        if (!res.ok) throw new GallaboxError(res.status, errorText(res.status, text));
        let id = '';
        try { id = String((JSON.parse(text) as { id?: unknown }).id ?? ''); } catch { /* checked below */ }
        if (!id) throw new GallaboxError(res.status, `Gallabox answered ${res.status} without a message id`);
        return { id };
      },
      async delivery(providerId) {
        if (!accountId) return null;
        const res = await fetchImpl(`${api}/accounts/${encodeURIComponent(accountId)}/messages/${encodeURIComponent(providerId)}/status`, {
          headers, signal: AbortSignal.timeout(20_000),
        });
        const text = await res.text();
        if (!res.ok) throw new GallaboxError(res.status, errorText(res.status, text));
        try { return readDelivery(JSON.parse(text)); } catch { return null; }
      },
    };
  }
  if (mode === 'file') {
    const dir = path.join(env.DATA_DIR, 'whatsapp-outbox');
    return {
      mode: 'file',
      async send(m) {
        mkdirSync(dir, { recursive: true });
        const id = `${new Date().toISOString().replace(/[:.]/g, '-')}-${m.to.replace(/\D/g, '')}`;
        const body = gallaboxTemplateBody(m.message, { channelId: env.GALLABOX_CHANNEL_ID || '(GALLABOX_CHANNEL_ID)', phone: m.to, name: m.name });
        writeFileSync(path.join(dir, `${id}.json`), `${JSON.stringify(body, null, 2)}\n`);
        writeFileSync(path.join(dir, `${id}.txt`), `To: ${m.to} (${m.name})\nTemplate: ${m.message.template}\n${m.message.imageUrl ? `Picture: ${m.message.imageUrl}\n` : ''}\n${m.message.text}\n\n[ ${TEMPLATE_TEXT.button} ] ${m.message.studioUrl}\n`);
        return { id: `file:${id}` };
      },
      async delivery() {
        return null;
      },
    };
  }
  return null;
}
