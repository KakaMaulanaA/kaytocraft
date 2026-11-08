// Server code only (also bundled into netlify/functions/design-background.mts, so no "server-only").
import { promises as fs } from "node:fs";
import path from "node:path";
import { getStore, type Store } from "@netlify/blobs";

/**
 * Tiny key/value file store with two backends:
 *  - "fs":    folders on disk (local PC: ./storage and ./library)
 *  - "blobs": Netlify Blobs (when deployed on Netlify, where the disk is not persistent)
 *
 * Keys look like "models/abc.glb" or "index.json".
 */
export interface KV {
  get(key: string): Promise<Buffer | null>;
  set(key: string, data: Buffer | Uint8Array | string): Promise<void>;
  del(key: string): Promise<void>;
  list(prefix?: string): Promise<string[]>;
  /** Total bytes under a prefix (best effort). */
  size(prefix?: string): Promise<number>;
}

/**
 * True when running on Netlify. NETLIFY is only set during the build, so next.config.ts
 * bakes it into KC_DEPLOY_TARGET; SITE_ID is set by Netlify at runtime as a fallback.
 * STORAGE_BACKEND=fs|blobs forces a backend (handy for testing).
 */
export const onNetlify = () =>
  process.env.STORAGE_BACKEND === "blobs" ||
  (process.env.STORAGE_BACKEND !== "fs" &&
    (process.env.KC_DEPLOY_TARGET === "netlify" || !!process.env.NETLIFY_BLOBS_CONTEXT || !!process.env.SITE_ID));

/** Running as the hosted (online) version — not the local PC. */
export const isHosted = () => process.env.KC_DEPLOY_TARGET === "netlify" || !!process.env.SITE_ID;

const safeKey = (key: string) => {
  if (!/^[\w./-]+$/.test(key) || key.includes("..")) throw new Error(`invalid key: ${key}`);
  return key;
};

// ------------------------------------------------------------------ disk

class FsKV implements KV {
  constructor(private root: string) {}
  private p(key: string) {
    return path.join(this.root, safeKey(key));
  }
  async get(key: string) {
    try {
      return await fs.readFile(this.p(key));
    } catch {
      return null;
    }
  }
  async set(key: string, data: Buffer | Uint8Array | string) {
    const file = this.p(key);
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`;
    await fs.writeFile(tmp, data);
    await fs.rename(tmp, file);
  }
  async del(key: string) {
    await fs.rm(this.p(key), { force: true });
  }
  async list(prefix = "") {
    const out: string[] = [];
    const walk = async (dir: string, rel: string) => {
      let names: string[] = [];
      try {
        names = await fs.readdir(dir);
      } catch {
        return;
      }
      for (const n of names) {
        if (n.includes(".tmp-")) continue;
        const full = path.join(dir, n);
        const r = rel ? `${rel}/${n}` : n;
        const st = await fs.stat(full).catch(() => null);
        if (!st) continue;
        if (st.isDirectory()) await walk(full, r);
        else if (r.startsWith(prefix)) out.push(r);
      }
    };
    await walk(this.root, "");
    return out;
  }
  async size(prefix = "") {
    let total = 0;
    for (const k of await this.list(prefix)) total += (await fs.stat(this.p(k)).catch(() => null))?.size ?? 0;
    return total;
  }
}

// ------------------------------------------------------------------ Netlify Blobs

/**
 * Fetch for the Blobs client: original (un-patched) fetch, and the body is read fully up front.
 * The client cancels the body of every 404, and cancelling a live stream inside the Next.js
 * server can hang forever; a buffered Response cancels instantly.
 */
const bufferedFetch: typeof fetch = async (input, init) => {
  const f = (globalThis.fetch as typeof fetch & { _nextOriginalFetch?: typeof fetch })._nextOriginalFetch ?? globalThis.fetch;
  const r = await f(input, { ...init, cache: "no-store" });
  const empty = r.status === 204 || r.status === 304 || init?.method?.toUpperCase() === "HEAD";
  const body = empty ? null : await r.arrayBuffer();
  return new Response(body, { status: r.status, statusText: r.statusText, headers: r.headers });
};

class BlobsKV implements KV {
  private store: Store | null = null;
  constructor(private name: string) {}
  // Created on first use: Netlify provides the Blobs context per request.
  private get storeP() {
    this.store ??= getStore({ name: this.name, consistency: "strong", fetch: bufferedFetch });
    return Promise.resolve(this.store);
  }
  async get(key: string) {
    const s = await this.storeP;
    const ab = (await s.get(safeKey(key), { type: "arrayBuffer" })) as ArrayBuffer | null;
    return ab ? Buffer.from(ab) : null;
  }
  async set(key: string, data: Buffer | Uint8Array | string) {
    const s = await this.storeP;
    const body = typeof data === "string" ? data : (new Uint8Array(data).buffer as ArrayBuffer);
    await s.set(safeKey(key), body);
  }
  async del(key: string) {
    await (await this.storeP).delete(safeKey(key));
  }
  async list(prefix = "") {
    const { blobs } = await (await this.storeP).list({ prefix });
    return blobs.map((b) => b.key);
  }
  async size() {
    return 0; // no cheap size listing on Blobs; callers sum recorded sizes instead
  }
}

// ------------------------------------------------------------------ the two buckets

const cwd = () => /* turbopackIgnore: true */ process.cwd();
let storageKV: KV | null = null;
let libraryKV: KV | null = null;

/** Generated assets, thumbnails, uploads, specs, concepts, db.json */
export function storageStore(): KV {
  storageKV ??= onNetlify()
    ? new BlobsKV("kaytocraft-storage")
    : new FsKV(path.resolve(/* turbopackIgnore: true */ process.env.STORAGE_DIR || path.join(cwd(), "storage")));
  return storageKV;
}

/** Knowledge Library (index.json, dictionary.json, recipes, models, thumbs) */
export function libraryStore(): KV {
  libraryKV ??= onNetlify()
    ? new BlobsKV("kaytocraft-library")
    : new FsKV(path.resolve(/* turbopackIgnore: true */ process.env.LIBRARY_DIR || path.join(cwd(), "library")));
  return libraryKV;
}

/** Serve bytes as a streamed response (Netlify allows 20 MB streamed vs 6 MB buffered). */
export function streamResponse(buf: Buffer, headers: Record<string, string>) {
  const CHUNK = 256 * 1024;
  let i = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(ctrl) {
      if (i >= buf.byteLength) return ctrl.close();
      ctrl.enqueue(new Uint8Array(buf.subarray(i, i + CHUNK)));
      i += CHUNK;
    },
  });
  return new Response(stream, { headers: { "Content-Length": String(buf.byteLength), ...headers } });
}
