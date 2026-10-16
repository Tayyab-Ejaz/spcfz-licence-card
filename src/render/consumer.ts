// Queue consumer for render jobs and for the dead-letter queue (docs/ARCHITECTURE.md section 6).
// The job carries { card_id, content_hash }; the card is reloaded and the job is dropped if a newer
// event has superseded it. Images are written only after all eight have rendered, so a failure
// leaves the previous set in place and the status unchanged.
//
// Called by the queue worker in src/platform/sqlite-queue.ts with MessageBatch-shaped objects.
import type { CardRow, Env, Lang, Message, MessageBatch, RenderJob, Size } from '../types.js';
import { LANGS, SIZE_NAMES } from '../types.js';
import { getCardById, setCardStatus } from '../db/cards.js';
import { purgeImageCache, putImage } from '../storage.js';
import { nowIso } from '../util/time.js';
import { renderCardWithBrowser } from './browser.js';

export interface RenderedImage {
  lang: Lang;
  size: Size;
  png: Uint8Array;
}

export interface RenderDeps {
  renderCard: (card: CardRow, env: Env) => Promise<RenderedImage[]>;
}

export const DLQ_ERROR = 'render failed after retries';

/** The real renderer. */
function defaultDeps(): RenderDeps {
  return { renderCard: renderCardWithBrowser };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Retry back-off in seconds: 30 s, 60 s, 90 s. */
function retryDelaySeconds(attempts: number): number {
  return Math.min(Math.max(attempts, 1) * 30, 600);
}

function readJob(msg: Message<RenderJob>): RenderJob | null {
  const body: Partial<RenderJob> | null | undefined = msg.body;
  if (!body || typeof body.card_id !== 'string' || typeof body.content_hash !== 'string') return null;
  return { card_id: body.card_id, content_hash: body.content_hash };
}

/** Every lang x size exactly once, or the set is rejected before anything is written. */
function assertCompleteSet(images: RenderedImage[]): void {
  const seen = new Set<string>();
  for (const img of images) {
    if (!(img.png instanceof Uint8Array) || img.png.byteLength === 0) throw new Error(`empty image for ${img.lang}-${img.size}`);
    seen.add(`${img.lang}-${img.size}`);
  }
  const missing: string[] = [];
  for (const lang of LANGS) for (const size of SIZE_NAMES) if (!seen.has(`${lang}-${size}`)) missing.push(`${lang}-${size}`);
  if (missing.length) throw new Error(`renderer returned an incomplete set, missing ${missing.join(', ')}`);
  if (images.length !== LANGS.length * SIZE_NAMES.length) throw new Error(`renderer returned ${images.length} images`);
}

async function handleRenderMessage(msg: Message<RenderJob>, env: Env, deps?: RenderDeps): Promise<void> {
  const job = readJob(msg);
  if (!job) {
    console.error('render: malformed job, dropping', { id: msg.id });
    msg.ack();
    return;
  }
  const { card_id, content_hash } = job;
  try {
    const card = await getCardById(env.DB, card_id);
    if (!card) {
      console.warn('render: card not found, dropping job', { card_id });
      msg.ack();
      return;
    }
    if (card.content_hash !== content_hash) {
      console.log('render: job superseded by a newer event, skipping', { card_id });
      msg.ack();
      return;
    }
    if (card.status === 'expired') {
      console.log('render: card expired, skipping', { card_id });
      msg.ack();
      return;
    }

    const d = deps ?? defaultDeps();
    const images = await d.renderCard(card, env);
    assertCompleteSet(images);

    await Promise.all(images.map((img) => putImage(env.BUCKET, card.token, img.lang, img.size, img.png)));
    await purgeImageCache(env, card.token);
    await setCardStatus(env.DB, card.id, 'ready', {
      rendered_at: nowIso(),
      render_error: null,
      template_version: env.TEMPLATE_VERSION,
    });
    console.log('render: ready', { card_id, licence_number: card.licence_number, attempts: msg.attempts });
    msg.ack();
  } catch (err) {
    console.error('render: failed', { card_id, attempts: msg.attempts, message: errorMessage(err) });
    msg.retry({ delaySeconds: retryDelaySeconds(msg.attempts) });
  }
}

export async function handleRenderBatch(batch: MessageBatch<RenderJob>, env: Env, deps?: RenderDeps): Promise<void> {
  // Sequential on purpose: one browser session at a time.
  for (const msg of batch.messages) await handleRenderMessage(msg, env, deps);
}

/**
 * Dead-letter consumer. Only the original body travels with the message, so the card is marked failed
 * with a fixed message. A card whose hash has moved on, or that has since rendered successfully or
 * expired, is left alone.
 */
export async function handleDeadLetters(batch: MessageBatch<RenderJob>, env: Env): Promise<void> {
  for (const msg of batch.messages) {
    const job = readJob(msg);
    try {
      if (!job) {
        console.error('dlq: malformed job', { id: msg.id });
      } else {
        const card = await getCardById(env.DB, job.card_id);
        if (!card) {
          console.warn('dlq: card not found', { card_id: job.card_id });
        } else if (card.content_hash !== job.content_hash || card.status === 'ready' || card.status === 'expired') {
          console.log('dlq: stale job, card left as is', { card_id: card.id, status: card.status });
        } else {
          const render_error = `${DLQ_ERROR} (queue ${batch.queue}, message ${msg.id})`.slice(0, 500);
          await setCardStatus(env.DB, card.id, 'failed', { render_error });
          console.error('dlq: card marked failed', { card_id: card.id, licence_number: card.licence_number });
        }
      }
    } catch (err) {
      console.error('dlq: could not mark card failed', { card_id: job?.card_id, message: errorMessage(err) });
    }
    msg.ack();
  }
}
