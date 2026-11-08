// Server code only (also bundled into netlify/functions/design-background.mts, so no "server-only").
import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { LibraryData, LibraryEntry } from "@/lib/library";
import { libraryStore, onNetlify } from "./blobstore";

/**
 * Knowledge Library (folder library/ locally, Netlify Blobs online):
 *   index.json        -> entries
 *   dictionary.json   -> { "kata": "english" }
 *   <id>.json         -> parts recipe (type=spec)
 *   <id>.glb|.fbx     -> model file (type=model)
 *   <id>.png          -> thumbnail
 */
const kv = () => libraryStore();
const INDEX = "index.json";
const DICT = "dictionary.json";
export const LIB_EXTS = ["json", "glb", "fbx", "png"] as const;

// Online the store starts empty: copy the library/ folder bundled with the deploy once.
let seeded: Promise<void> | null = null;
function seed() {
  if (!onNetlify()) return Promise.resolve();
  seeded ??= (async () => {
    if (await kv().get(INDEX)) return;
    const dir = path.join(/* turbopackIgnore: true */ process.cwd(), "library");
    let names: string[] = [];
    try {
      names = await fs.readdir(dir);
    } catch {
      return;
    }
    // Files first, index last, so a half-finished seed is retried.
    for (const n of names.filter((n) => n !== INDEX && /^[\w.-]+$/.test(n)))
      await kv().set(n, await fs.readFile(path.join(dir, n)));
    if (names.includes(INDEX)) await kv().set(INDEX, await fs.readFile(path.join(dir, INDEX)));
    else await kv().set(INDEX, "[]");
  })().catch((e) => {
    seeded = null;
    throw e;
  });
  return seeded;
}

let queue: Promise<unknown> = Promise.resolve();
function locked<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

async function readJson<T>(key: string, fallback: T): Promise<T> {
  await seed();
  const b = await kv().get(key);
  if (!b) return fallback;
  try {
    return JSON.parse(b.toString("utf8")) as T;
  } catch {
    return fallback;
  }
}
const writeJson = (key: string, data: unknown) => kv().set(key, JSON.stringify(data, null, 2));

export const libId = () => crypto.randomBytes(5).toString("hex");
export const libKey = (id: string, ext: string) => `${id}.${ext}`;
export const validId = (id: string) => /^[a-f0-9]{10}$/.test(id);

export async function readLibFile(id: string, ext: string) {
  await seed();
  return kv().get(libKey(id, ext));
}
export const writeLibFile = (id: string, ext: string, data: Buffer | Uint8Array | string) => kv().set(libKey(id, ext), data);
export const removeLibFiles = (id: string) => Promise.all(LIB_EXTS.map((x) => kv().del(libKey(id, x))));

export function readLibrary(): Promise<LibraryData> {
  return locked(async () => ({
    entries: (await readJson<LibraryEntry[]>(INDEX, [])).sort((a, b) => b.createdAt - a.createdAt),
    dictionary: await readJson<Record<string, string>>(DICT, {}),
  }));
}

export async function readDictionary() {
  return readJson<Record<string, string>>(DICT, {});
}

export function addEntry(e: LibraryEntry) {
  return locked(async () => {
    const list = await readJson<LibraryEntry[]>(INDEX, []);
    list.push(e);
    await writeJson(INDEX, list);
    return e;
  });
}

export function updateEntry(id: string, patch: Partial<LibraryEntry>) {
  return locked(async () => {
    const list = await readJson<LibraryEntry[]>(INDEX, []);
    const i = list.findIndex((e) => e.id === id);
    if (i < 0) return null;
    list[i] = { ...list[i], ...patch, id };
    await writeJson(INDEX, list);
    return list[i];
  });
}

export function removeEntry(id: string) {
  return locked(async () => {
    const list = await readJson<LibraryEntry[]>(INDEX, []);
    const e = list.find((x) => x.id === id);
    await writeJson(INDEX, list.filter((x) => x.id !== id));
    if (e) await removeLibFiles(id);
    return e ?? null;
  });
}

export function setWord(word: string, english: string | null) {
  return locked(async () => {
    const dict = await readJson<Record<string, string>>(DICT, {});
    const k = word.trim().toLowerCase();
    if (!k) return dict;
    if (english && english.trim()) dict[k] = english.trim();
    else delete dict[k];
    await writeJson(DICT, dict);
    return dict;
  });
}
