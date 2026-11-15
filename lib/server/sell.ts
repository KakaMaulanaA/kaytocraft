import "server-only";
import { listKeys, newId, readFile, removeFile, saveBuffer, sellBlendKey, sellRecKey, sellZipKey } from "./storage";
import { clearRemote } from "./blendRemote";

/** One fixed .blend uploaded on the Siap Jual page. */
export interface SellItem {
  id: string;
  name: string;
  size: number;
  createdAt: number;
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
  const next = { ...item, size: blend.length, createdAt: Date.now() };
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
