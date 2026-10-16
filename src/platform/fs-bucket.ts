// R2-shaped object store over the filesystem (docs/PORT-TO-NODE.md section 2). Keys map to files under the
// bucket root (`cards/<token>/en-square.png` -> `<root>/cards/<token>/en-square.png`); the etag (hex SHA-1
// of the content) and the HTTP metadata live beside each file in `<name>.meta.json`. Writes are atomic
// (temp file + rename) so a crash mid-write never leaves a half image behind.
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { R2Bucket, R2HTTPMetadata, R2Object, R2ObjectBody, R2PutOptions, R2PutValue } from '../types.js';

const META_SUFFIX = '.meta.json';
const TMP_MARKER = '.tmp-';
const MAX_KEY_LENGTH = 1024;

interface StoredMeta {
  etag: string;
  size: number;
  uploaded: string;
  httpMetadata: R2HTTPMetadata;
}

/** Keys are relative, slash-separated, and may not escape the root. Throws on anything else. */
export function validateKey(key: string): void {
  if (typeof key !== 'string' || key.length === 0) throw new Error('bucket: empty key');
  if (key.length > MAX_KEY_LENGTH) throw new Error('bucket: key too long');
  if (key.startsWith('/') || key.includes('\\') || key.includes('\0')) throw new Error(`bucket: invalid key ${JSON.stringify(key)}`);
  for (const seg of key.split('/')) {
    if (seg === '' || seg === '.' || seg === '..') throw new Error(`bucket: invalid key ${JSON.stringify(key)}`);
    if (seg.endsWith(META_SUFFIX) || seg.includes(TMP_MARKER)) throw new Error(`bucket: reserved key ${JSON.stringify(key)}`);
  }
}

async function toBuffer(value: R2PutValue): Promise<Buffer> {
  if (typeof value === 'string') return Buffer.from(value, 'utf8');
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (typeof Blob !== 'undefined' && value instanceof Blob) return Buffer.from(await value.arrayBuffer());
  if (value instanceof ReadableStream) {
    const chunks: Uint8Array[] = [];
    const reader = value.getReader();
    for (;;) {
      const { done, value: chunk } = await reader.read();
      if (done) break;
      if (chunk) chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }
  throw new TypeError('bucket: unsupported body type');
}

function sha1(bytes: Buffer): string {
  return createHash('sha1').update(bytes).digest('hex');
}

function isNotFound(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'ENOENT';
}

async function writeAtomic(file: string, bytes: Buffer | string): Promise<void> {
  const tmp = `${file}${TMP_MARKER}${randomUUID()}`;
  try {
    await fs.writeFile(tmp, bytes);
    await fs.rename(tmp, file);
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    throw err;
  }
}

export class FsBucket implements R2Bucket {
  constructor(readonly root: string) {}

  private fileFor(key: string): string {
    validateKey(key);
    const file = path.resolve(this.root, ...key.split('/'));
    const rootResolved = path.resolve(this.root);
    if (file !== rootResolved && !file.startsWith(rootResolved + path.sep)) throw new Error(`bucket: key escapes root ${JSON.stringify(key)}`);
    return file;
  }

  private async readMeta(file: string, key: string): Promise<R2Object | null> {
    let stat;
    try {
      stat = await fs.stat(file);
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
    if (!stat.isFile()) return null;
    let meta: StoredMeta | null = null;
    try {
      meta = JSON.parse(await fs.readFile(`${file}${META_SUFFIX}`, 'utf8')) as StoredMeta;
    } catch (err) {
      if (!isNotFound(err)) throw err;
    }
    // A file without its sidecar (copied in by hand, say) still serves; the etag is computed on the spot.
    const etag = meta?.etag ?? sha1(await fs.readFile(file));
    return {
      key,
      size: stat.size,
      etag,
      httpEtag: `"${etag}"`,
      uploaded: new Date(meta?.uploaded ?? stat.mtime.toISOString()),
      httpMetadata: meta?.httpMetadata ?? {},
    };
  }

  async put(key: string, value: R2PutValue, options: R2PutOptions = {}): Promise<R2Object> {
    const file = this.fileFor(key);
    const bytes = await toBuffer(value);
    const etag = sha1(bytes);
    const meta: StoredMeta = {
      etag,
      size: bytes.byteLength,
      uploaded: new Date().toISOString(),
      httpMetadata: { ...(options.httpMetadata ?? {}) },
    };
    await fs.mkdir(path.dirname(file), { recursive: true });
    await writeAtomic(file, bytes);
    await writeAtomic(`${file}${META_SUFFIX}`, JSON.stringify(meta));
    return { key, size: meta.size, etag, httpEtag: `"${etag}"`, uploaded: new Date(meta.uploaded), httpMetadata: meta.httpMetadata };
  }

  async head(key: string): Promise<R2Object | null> {
    return this.readMeta(this.fileFor(key), key);
  }

  async get(key: string): Promise<R2ObjectBody | null> {
    const file = this.fileFor(key);
    const head = await this.readMeta(file, key);
    if (!head) return null;
    let bytes: Buffer;
    try {
      bytes = await fs.readFile(file);
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
    const view = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(view);
        controller.close();
      },
    });
    return {
      ...head,
      size: bytes.byteLength,
      body,
      arrayBuffer: async () => view.slice().buffer,
      text: async () => bytes.toString('utf8'),
    };
  }

  async delete(keys: string | string[]): Promise<void> {
    for (const key of Array.isArray(keys) ? keys : [keys]) {
      const file = this.fileFor(key);
      await fs.rm(file, { force: true });
      await fs.rm(`${file}${META_SUFFIX}`, { force: true });
      // Tidy an emptied folder; never remove the root itself. Best effort.
      const dir = path.dirname(file);
      if (dir !== path.resolve(this.root)) await fs.rmdir(dir).catch(() => undefined);
    }
  }

  async list(options: { prefix?: string } = {}): Promise<{ objects: R2Object[]; truncated: false }> {
    const prefix = options.prefix ?? '';
    const root = path.resolve(this.root);
    const keys: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch (err) {
        if (isNotFound(err)) return;
        throw err;
      }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
        } else if (entry.isFile() && !entry.name.endsWith(META_SUFFIX) && !entry.name.includes(TMP_MARKER)) {
          const key = path.relative(root, full).split(path.sep).join('/');
          if (key.startsWith(prefix)) keys.push(key);
        }
      }
    };
    await walk(root);
    keys.sort();
    const objects: R2Object[] = [];
    for (const key of keys) {
      const obj = await this.readMeta(path.resolve(root, ...key.split('/')), key);
      if (obj) objects.push(obj);
    }
    return { objects, truncated: false };
  }
}
