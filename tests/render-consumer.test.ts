// Queue consumer against a fresh SQLite database and image folder (tests/env.ts), with the browser renderer
// replaced by a stub (RenderDeps). Nothing here launches Chromium.
import { describe, expect, it, vi } from 'vitest';
import type { CardRow, Env, MessageBatch, RenderJob } from '../src/types.js';
import { LANGS, SIZE_NAMES } from '../src/types.js';
import { getCardById, insertCard, setCardStatus } from '../src/db/cards.js';
import { DLQ_ERROR, handleDeadLetters, handleRenderBatch } from '../src/render/consumer.js';
import type { RenderDeps, RenderedImage } from '../src/render/consumer.js';
import { imageKey } from '../src/storage.js';
import { randomToken } from '../src/util/crypto.js';
import { createTestEnv } from './env.js';

const env = createTestEnv();

// A 1x1 transparent PNG, 70 bytes.
const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
function tinyPng(): Uint8Array {
  return Uint8Array.from(atob(PNG_1X1), (c) => c.charCodeAt(0));
}

function allImages(): RenderedImage[] {
  return LANGS.flatMap((lang) => SIZE_NAMES.map((size) => ({ lang, size, png: tinyPng() })));
}

let seq = 0;
async function createCard(is_test = false): Promise<CardRow> {
  seq += 1;
  return insertCard(env.DB, {
    token: randomToken(),
    is_test,
    fields: {
      licence_number: `SPC-2026-${String(seq).padStart(5, '0')}`,
      company_name_en: 'Nimbus Publishing FZE',
      company_name_ar: 'نيمبوس للنشر م.م.ح',
      licence_type: null,
      activity_category: 'Publishing',
      issued_on: '2026-10-15',
      preferred_language: 'en',
    },
    content_hash: `hash-${seq}`,
    source: 'test',
    template_version: env.TEMPLATE_VERSION,
    expires_at: null,
  });
}

function fakeBatch(job: RenderJob, queue = 'spcfz-licence-card-render') {
  const ack = vi.fn();
  const retry = vi.fn();
  const message = { id: `msg-${job.card_id}`, timestamp: new Date(), body: job, attempts: 1, ack, retry };
  const batch = { queue, messages: [message], ackAll: vi.fn(), retryAll: vi.fn() } as unknown as MessageBatch<RenderJob>;
  return { batch, ack, retry };
}

function expectedKeys(token: string): string[] {
  return LANGS.flatMap((lang) => SIZE_NAMES.map((size) => imageKey(token, lang, size))).sort();
}

async function storedKeys(token: string): Promise<string[]> {
  const listed = await env.BUCKET.list({ prefix: `cards/${token}/` });
  return listed.objects.map((o) => o.key).sort();
}

describe('handleRenderBatch', () => {
  it('renders, stores eight images, marks the card ready and acks', async () => {
    const card = await createCard();
    const renderCard = vi.fn(async (_card: CardRow, _env: Env): Promise<RenderedImage[]> => allImages());
    const deps: RenderDeps = { renderCard };
    const { batch, ack, retry } = fakeBatch({ card_id: card.id, content_hash: card.content_hash });

    await handleRenderBatch(batch, env, deps);

    expect(renderCard).toHaveBeenCalledTimes(1);
    expect(renderCard.mock.calls[0]?.[0]?.id).toBe(card.id);
    expect(await storedKeys(card.token)).toEqual(expectedKeys(card.token));
    for (const key of expectedKeys(card.token)) {
      const head = await env.BUCKET.head(key);
      expect(head).not.toBeNull();
      expect(head?.httpMetadata?.contentType).toBe('image/png');
      expect(head?.size).toBe(tinyPng().byteLength);
    }

    const after = await getCardById(env.DB, card.id);
    expect(after?.status).toBe('ready');
    expect(after?.rendered_at).toBeTruthy();
    expect(after?.render_error).toBeNull();
    expect(after?.template_version).toBe(env.TEMPLATE_VERSION);
    expect(ack).toHaveBeenCalledTimes(1);
    expect(retry).not.toHaveBeenCalled();
  });

  it('acks and skips a job whose content_hash no longer matches the card', async () => {
    const card = await createCard();
    const renderCard = vi.fn(async (): Promise<RenderedImage[]> => allImages());
    const { batch, ack, retry } = fakeBatch({ card_id: card.id, content_hash: 'stale-hash' });

    await handleRenderBatch(batch, env, { renderCard });

    expect(renderCard).not.toHaveBeenCalled();
    expect(await storedKeys(card.token)).toEqual([]);
    expect((await getCardById(env.DB, card.id))?.status).toBe('pending');
    expect(ack).toHaveBeenCalledTimes(1);
    expect(retry).not.toHaveBeenCalled();
  });

  it('retries when the renderer throws and leaves the card pending with no images', async () => {
    const card = await createCard();
    const renderCard = vi.fn(async (): Promise<RenderedImage[]> => {
      throw new Error('browser exploded');
    });
    const { batch, ack, retry } = fakeBatch({ card_id: card.id, content_hash: card.content_hash });

    await handleRenderBatch(batch, env, { renderCard });

    expect(renderCard).toHaveBeenCalledTimes(1);
    expect(retry).toHaveBeenCalledTimes(1);
    expect(ack).not.toHaveBeenCalled();
    expect(await storedKeys(card.token)).toEqual([]);
    const after = await getCardById(env.DB, card.id);
    expect(after?.status).toBe('pending');
    expect(after?.rendered_at).toBeNull();
  });

  it('retries when the renderer returns an incomplete set, writing nothing', async () => {
    const card = await createCard();
    const renderCard = vi.fn(async (): Promise<RenderedImage[]> => allImages().slice(0, 7));
    const { batch, ack, retry } = fakeBatch({ card_id: card.id, content_hash: card.content_hash });

    await handleRenderBatch(batch, env, { renderCard });

    expect(retry).toHaveBeenCalledTimes(1);
    expect(ack).not.toHaveBeenCalled();
    expect(await storedKeys(card.token)).toEqual([]);
    expect((await getCardById(env.DB, card.id))?.status).toBe('pending');
  });

  it('acks a job for a card that no longer exists', async () => {
    const renderCard = vi.fn(async (): Promise<RenderedImage[]> => allImages());
    const { batch, ack, retry } = fakeBatch({ card_id: '01JA0000000000000000000000', content_hash: 'x' });

    await handleRenderBatch(batch, env, { renderCard });

    expect(renderCard).not.toHaveBeenCalled();
    expect(ack).toHaveBeenCalledTimes(1);
    expect(retry).not.toHaveBeenCalled();
  });

  it('acks and skips an expired card', async () => {
    const card = await createCard();
    await setCardStatus(env.DB, card.id, 'expired');
    const renderCard = vi.fn(async (): Promise<RenderedImage[]> => allImages());
    const { batch, ack, retry } = fakeBatch({ card_id: card.id, content_hash: card.content_hash });

    await handleRenderBatch(batch, env, { renderCard });

    expect(renderCard).not.toHaveBeenCalled();
    expect(await storedKeys(card.token)).toEqual([]);
    expect((await getCardById(env.DB, card.id))?.status).toBe('expired');
    expect(ack).toHaveBeenCalledTimes(1);
    expect(retry).not.toHaveBeenCalled();
  });
});

describe('handleDeadLetters', () => {
  it('marks the card failed with an error and acks', async () => {
    const card = await createCard();
    const { batch, ack, retry } = fakeBatch({ card_id: card.id, content_hash: card.content_hash }, 'spcfz-licence-card-dlq');

    await handleDeadLetters(batch, env);

    const after = await getCardById(env.DB, card.id);
    expect(after?.status).toBe('failed');
    expect(after?.render_error).toContain(DLQ_ERROR);
    expect((after?.render_error ?? '').length).toBeLessThanOrEqual(500);
    expect(ack).toHaveBeenCalledTimes(1);
    expect(retry).not.toHaveBeenCalled();
  });

  it('leaves a card alone when a newer event has superseded the dead job', async () => {
    const card = await createCard();
    const { batch, ack } = fakeBatch({ card_id: card.id, content_hash: 'older-hash' }, 'spcfz-licence-card-dlq');

    await handleDeadLetters(batch, env);

    expect((await getCardById(env.DB, card.id))?.status).toBe('pending');
    expect(ack).toHaveBeenCalledTimes(1);
  });

  it('acks a dead job for a missing card without throwing', async () => {
    const { batch, ack } = fakeBatch({ card_id: '01JA0000000000000000000001', content_hash: 'x' }, 'spcfz-licence-card-dlq');
    await handleDeadLetters(batch, env);
    expect(ack).toHaveBeenCalledTimes(1);
  });
});
