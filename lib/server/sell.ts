import "server-only";
import { strFromU8, unzipSync } from "fflate";
import { listKeys, newId, readFile, removeFile, saveBuffer, sellBlendKey, sellRecKey, sellZipKey } from "./storage";
import { clearRemote } from "./blendRemote";

/** One fixed .blend uploaded on the Siap Jual page. */
export interface SellItem {
  id: string;
  name: string;
  size: number;
  createdAt: number;
  /** What the last render found (from the package itself). */
  notes?: PackNotes;
}

export interface PackNotes {
  /** Camera renders in the package (clay not counted). */
  renders: number;
  /** The file had no camera: three automatic cameras were used. */
  autoCamera: boolean;
  /** External textures / HDR the .blend points to but did not pack. */
  missing: string[];
}

/** Read a finished package: how many renders, automatic cameras, missing external files. */
export function packNotes(zip: Buffer): PackNotes {
  const files = unzipSync(new Uint8Array(zip), { filter: (f) => f.name.endsWith("INFO.txt") || /\/renders\/[^/]+\.png$/.test(f.name) });
  const names = Object.keys(files);
  const info = names.find((n) => n.endsWith("INFO.txt"));
  const text = info ? strFromU8(files[info]) : "";
  const line = text.split("\n").find((l) => l.startsWith("PERINGATAN"));
  const missing = line ? line.slice(line.indexOf(":", line.indexOf("pack")) + 1).split(",").map((x) => x.trim()).filter(Boolean) : [];
  return {
    renders: names.filter((n) => /\/renders\/[^/]+\.png$/.test(n) && !/_clay\.png$/.test(n)).length,
    autoCamera: /kamera otomatis/.test(text),
    missing,
  };
}

/** Remember what the render found, so the list can warn about it. */
export async function setSellNotes(id: string, notes: PackNotes) {
  const cur = await getSell(id);
  if (cur) await saveBuffer(sellRecKey(id), JSON.stringify({ ...cur, notes }));
}

export const validSellId = (id: string) => /^[a-f0-9]{12}$/.test(id);

/** "03_Meja_Belajar_Kayu (fix).blend" -> "Meja Belajar Kayu". */
export function nameFromFile(file: string) {
  return (
    file
      .replace(/\.blend\d*$/i, "")
      .replace(/^\d+[_\-. ]+/, "")
      .replace(/[_]+/g, " ")
      .replace(/\s*\((fix|final|revisi|perbaikan)\)\s*$/i, "")
      .replace(/[^\p{L}\p{N}\- ]+/gu, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80) || "Model"
  );
}

export async function getSell(id: string): Promise<SellItem | null> {
  if (!validSellId(id)) return null;
  const b = await readFile(sellRecKey(id));
  if (!b) return null;
  try {
    return JSON.parse(b.toString("utf8")) as SellItem;
  } catch {
    return null;
  }
}

export async function listSell(): Promise<SellItem[]> {
  const keys = (await listKeys("sell/")).filter((k) => /^sell\/[a-f0-9]{12}\.json$/.test(k));
  const items = await Promise.all(keys.map((k) => getSell(k.slice(5, 17))));
  return items.filter((x): x is SellItem => !!x).sort((a, b) => b.createdAt - a.createdAt);
}

export async function createSell(name: string, blend: Buffer): Promise<SellItem> {
  const item: SellItem = { id: newId(), name, size: blend.length, createdAt: Date.now() };
  await saveBuffer(sellBlendKey(item.id), blend);
  await saveBuffer(sellRecKey(item.id), JSON.stringify(item));
  return item;
}

/** Replace the .blend (a newer fix); the old package is dropped so it is rendered again. */
export async function replaceSell(item: SellItem, blend: Buffer): Promise<SellItem> {
  const next = { ...item, size: blend.length, createdAt: Date.now(), notes: undefined };
  await saveBuffer(sellBlendKey(item.id), blend);
  await removeFile(sellZipKey(item.id));
  await clearRemote(item.id, "sell");
  await saveBuffer(sellRecKey(item.id), JSON.stringify(next));
  return next;
}

export async function deleteSell(id: string) {
  await Promise.all([removeFile(sellRecKey(id)), removeFile(sellBlendKey(id)), removeFile(sellZipKey(id)), clearRemote(id, "sell")]);
}

/** Real .blend files: plain ("BLENDER"), gzip, or zstd-compressed (Blender 3+/5 "compress"). */
export function looksLikeBlend(b: Buffer) {
  if (b.length < 12) return false;
  if (b.subarray(0, 7).toString("latin1") === "BLENDER") return true;
  if (b[0] === 0x1f && b[1] === 0x8b) return true;
  return b[0] === 0x28 && b[1] === 0xb5 && b[2] === 0x2f && b[3] === 0xfd;
}
