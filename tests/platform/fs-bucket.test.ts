// R2-shape fidelity of the filesystem bucket.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { FsBucket, validateKey } from '../../src/platform/fs-bucket.js';
import { tempDir } from '../env.js';

const dir = tempDir('spcfz-bucket-');
const root = path.join(dir, 'images');
const bucket = new FsBucket(root);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82]);
const sha1 = (b: Uint8Array): string => createHash('sha1').update(b).digest('hex');

beforeEach(() => {
  rmSync(root, { recursive: true, force: true });
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  return Buffer.concat(chunks);
}

describe('FsBucket (R2 shape)', () => {
  it('put/get round-trips the bytes with contentType, size and a sha1 etag', async () => {
    const put = await bucket.put('cards/tok/en-square.png', PNG, { httpMetadata: { contentType: 'image/png', cacheControl: 'public, max-age=1' } });
    expect(put.etag).toBe(sha1(PNG));
    expect(put.httpEtag).toBe(`"${sha1(PNG)}"`);
    expect(put.size).toBe(PNG.byteLength);

    const got = await bucket.get('cards/tok/en-square.png');
    expect(got).not.toBeNull();
    expect(got?.httpMetadata.contentType).toBe('image/png');
    expect(got?.httpMetadata.cacheControl).toBe('public, max-age=1');
    expect(got?.size).toBe(PNG.byteLength);
    expect(got?.httpEtag).toBe(`"${sha1(PNG)}"`);
    expect(got?.uploaded).toBeInstanceOf(Date);
    expect(new Uint8Array(await readAll(got!.body))).toEqual(PNG);
    expect(new Uint8Array(await (await bucket.get('cards/tok/en-square.png'))!.arrayBuffer())).toEqual(PNG);

    // The sidecar sits beside the file.
    expect(existsSync(path.join(root, 'cards', 'tok', 'en-square.png'))).toBe(true);
    expect(existsSync(path.join(root, 'cards', 'tok', 'en-square.png.meta.json'))).toBe(true);
  });

  it('accepts strings, ArrayBuffers, Blobs and streams as bodies', async () => {
    await bucket.put('a/str', 'hello');
    await bucket.put('a/ab', PNG.buffer.slice(PNG.byteOffset, PNG.byteOffset + PNG.byteLength));
    await bucket.put('a/blob', new Blob([PNG]));
    await bucket.put('a/stream', new Blob([PNG]).stream() as ReadableStream<Uint8Array>);
    expect(await (await bucket.get('a/str'))!.text()).toBe('hello');
    for (const key of ['a/ab', 'a/blob', 'a/stream']) {
      expect(new Uint8Array(await (await bucket.get(key))!.arrayBuffer())).toEqual(PNG);
    }
  });

  it('head() has the metadata without a body; missing keys answer null', async () => {
    expect(await bucket.head('nope/x')).toBeNull();
    expect(await bucket.get('nope/x')).toBeNull();
    await bucket.put('cards/t/ar-story.png', PNG, { httpMetadata: { contentType: 'image/png' } });
    const head = await bucket.head('cards/t/ar-story.png');
    expect(head?.key).toBe('cards/t/ar-story.png');
    expect(head?.size).toBe(PNG.byteLength);
    expect(head?.httpMetadata?.contentType).toBe('image/png');
    expect(head && 'body' in head).toBe(false);
  });

  it('overwrites in place with a new etag', async () => {
    await bucket.put('k', 'one');
    const first = await bucket.head('k');
    await bucket.put('k', 'two');
    const second = await bucket.head('k');
    expect(second?.etag).not.toBe(first?.etag);
    expect(await (await bucket.get('k'))!.text()).toBe('two');
  });

  it('delete() takes one key or many, ignores missing ones, and tidies empty folders', async () => {
    await bucket.put('cards/t1/en-square.png', PNG);
    await bucket.put('cards/t1/ar-square.png', PNG);
    await bucket.put('cards/t2/en-square.png', PNG);
    await bucket.delete('cards/t1/en-square.png');
    expect(await bucket.head('cards/t1/en-square.png')).toBeNull();
    expect(await bucket.head('cards/t1/ar-square.png')).not.toBeNull();
    await bucket.delete(['cards/t1/ar-square.png', 'cards/t2/en-square.png', 'cards/none/en-square.png']);
    expect(await bucket.head('cards/t1/ar-square.png')).toBeNull();
    expect(await bucket.head('cards/t2/en-square.png')).toBeNull();
    expect(existsSync(path.join(root, 'cards', 't1'))).toBe(false);
    expect(existsSync(path.join(root, 'cards', 't2'))).toBe(false);
  });

  it('list({ prefix }) returns matching keys sorted, without sidecars', async () => {
    await bucket.put('cards/b/en-square.png', PNG);
    await bucket.put('cards/a/ar-story.png', PNG);
    await bucket.put('cards/a/en-square.png', PNG);
    await bucket.put('other/x.bin', PNG);
    const all = await bucket.list();
    expect(all.truncated).toBe(false);
    expect(all.objects.map((o) => o.key)).toEqual(['cards/a/ar-story.png', 'cards/a/en-square.png', 'cards/b/en-square.png', 'other/x.bin']);
    const a = await bucket.list({ prefix: 'cards/a/' });
    expect(a.objects.map((o) => o.key)).toEqual(['cards/a/ar-story.png', 'cards/a/en-square.png']);
    expect(a.objects[0]?.size).toBe(PNG.byteLength);
    expect((await bucket.list({ prefix: 'cards/zzz/' })).objects).toEqual([]);
    expect((await new FsBucket(path.join(dir, 'does-not-exist')).list()).objects).toEqual([]);
  });

  it('serves a file dropped in without a sidecar, computing the etag', async () => {
    mkdirSync(path.join(root, 'cards', 'manual'), { recursive: true });
    writeFileSync(path.join(root, 'cards', 'manual', 'en-square.png'), PNG);
    const head = await bucket.head('cards/manual/en-square.png');
    expect(head?.etag).toBe(sha1(PNG));
    expect(head?.httpMetadata).toEqual({});
  });

  it('rejects keys that could escape the root or collide with internals', async () => {
    for (const bad of ['', '/abs', '../x', 'a/../../x', 'a//b', 'a/./b', 'a\\b', 'a/b.meta.json', 'a/b.tmp-1']) {
      expect(() => validateKey(bad), bad).toThrow();
      await expect(bucket.put(bad, PNG), bad).rejects.toThrow();
      await expect(bucket.get(bad), bad).rejects.toThrow();
    }
    expect(() => validateKey('cards/AbCdEfGhIjKlMnOpQrStUv/en-square.png')).not.toThrow();
  });
});
