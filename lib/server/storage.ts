import "server-only";
import crypto from "node:crypto";
import type { Asset } from "@/lib/types";
import { onNetlify, storageStore } from "./blobstore";

/**
 * Asset store (works on disk locally and on Netlify Blobs online):
 *   assets/<id>.json          -> asset record (one key per asset: safe with parallel serverless calls)
 *   models/<id>.<ext>         -> model files
 *   thumbs/<id>.(png|webp|jpg)-> thumbnails
 *   uploads/<id>.<ext>        -> reference images
 *   concepts/<id>.json|png    -> 2D concept images (pre-3D)
 *   specs/<id>.json           -> recipe of procedural/AI-designed models
 *   blend/<id>.blend          -> cached .blend conversions
 */
const kv = () => storageStore();
const recKey = (id: string) => `assets/${id}.json`;
const validAssetId = (id: string) => /^[a-f0-9]{12}$/.test(id);

export const newId = () => crypto.randomBytes(6).toString("hex");

// Older versions kept every record in db.json; split it once into per-asset keys.
let migrated: Promise<void> | null = null;
function migrate() {
  migrated ??= (async () => {
    const old = await kv().get("db.json");
    if (!old) return;
    try {
      const list = JSON.parse(old.toString("utf8")) as Asset[];
      for (const a of list) if (validAssetId(a.id) && !(await kv().get(recKey(a.id)))) await kv().set(recKey(a.id), JSON.stringify(a));
      await kv().set("db.migrated.json", old);
      await kv().del("db.json");
    } catch {}
  })();
  return migrated;
}

// Serialize writes inside one process (read-modify-write of a single record).
let queue: Promise<unknown> = Promise.resolve();
function locked<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

async function readRec(id: string): Promise<Asset | null> {
  if (!validAssetId(id)) return null;
  const b = await kv().get(recKey(id));
  if (!b) return null;
  try {
    return JSON.parse(b.toString("utf8")) as Asset;
  } catch {
    return null;
  }
}

export async function listAssets() {
  await migrate();
  const keys = (await kv().list("assets/")).filter((k) => k.endsWith(".json"));
  const recs = await Promise.all(keys.map((k) => readRec(k.slice(7, -5))));
  return recs.filter((a): a is Asset => !!a).sort((a, b) => b.createdAt - a.createdAt);
}

export async function getAsset(id: string) {
  await migrate();
  return readRec(id);
}

export function insertAsset(asset: Asset) {
  return locked(async () => {
    await kv().set(recKey(asset.id), JSON.stringify(asset));
    return asset;
  });
}

export function updateAsset(id: string, patch: Partial<Asset> | ((a: Asset) => Partial<Asset>)) {
  return locked(async () => {
    const cur = await readRec(id);
    if (!cur) return null;
    const p = typeof patch === "function" ? patch(cur) : patch;
    const next = { ...cur, ...p, provider: { ...cur.provider, ...(p.provider ?? {}) } };
    await kv().set(recKey(id), JSON.stringify(next));
    return next;
  });
}

export function deleteAsset(id: string) {
  return locked(async () => {
    const asset = await readRec(id);
    if (!asset) return null;
    await kv().del(recKey(id));
    const keys = [modelKey(asset), `blend/${id}.blend`, `specs/${id}.json`, ...thumbKeys(id)];
    for (const ext of ["png", "jpg", "webp"]) keys.push(`uploads/${id}.${ext}`);
    await Promise.all(keys.map((k) => (k ? kv().del(k) : null)));
    return asset;
  });
}

export function modelKey(asset: Pick<Asset, "id" | "format">) {
  return asset.format ? `models/${asset.id}.${asset.format}` : null;
}

export const thumbKeys = (id: string) => ["png", "webp", "jpg"].map((ext) => `thumbs/${id}.${ext}`);

export async function findThumb(id: string): Promise<{ key: string; buf: Buffer } | null> {
  if (!validAssetId(id)) return null;
  for (const key of thumbKeys(id)) {
    const buf = await kv().get(key);
    if (buf) return { key, buf };
  }
  return null;
}

export const readFile = (key: string) => kv().get(key);

export async function saveBuffer(key: string, buf: Buffer | Uint8Array | string) {
  await kv().set(key, buf);
  return typeof buf === "string" ? Buffer.byteLength(buf) : buf.byteLength;
}

export const removeFile = (key: string) => kv().del(key);

/** Download a remote file (provider URLs expire fast, so we keep our own copy). */
export async function download(url: string, key: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download gagal (${res.status})`);
  return saveBuffer(key, Buffer.from(await res.arrayBuffer()));
}

export async function storageUsage() {
  // Online: sum the recorded file sizes (reading every blob would be slow).
  if (onNetlify()) return (await listAssets()).reduce((n, a) => n + (a.fileSize ?? 0), 0);
  try {
    return await kv().size("");
  } catch {
    return 0;
  }
}
