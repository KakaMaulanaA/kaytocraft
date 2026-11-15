import type { Asset } from "./types";
import { appendFile } from "./upload";

/**
 * "Paket Siap Jual" in the browser: waits while the package is made (online on GitHub Actions,
 * ±2–6 min the first time), then downloads it in parts and joins them.
 */
export async function fetchPack(id: string, onStatus?: (msg: string) => void, signal?: AbortSignal): Promise<Uint8Array> {
  const started = Date.now();
  for (;;) {
    if (signal?.aborted) throw new Error("Dihentikan.");
    const res = await fetch(`/api/assets/${id}/pack`, { cache: "no-store" });
    const body = await res.json().catch(() => null);
    if (res.status === 202) {
      const mins = Math.floor((Date.now() - started) / 60_000);
      onStatus?.(`${body?.step === "blend" ? "Menyiapkan .blend" : "Render paket"}… ${mins ? `${mins} mnt` : ""}`.trim());
      if (Date.now() - started > 45 * 60_000) throw new Error("Paket terlalu lama. Coba klik lagi nanti.");
      await new Promise((r) => setTimeout(r, 8000));
      continue;
    }
    if (!res.ok) throw new Error(body?.error || `Gagal membuat paket (${res.status})`);
    const parts: number = body.parts;
    const out = new Uint8Array(body.size);
    let at = 0;
    for (let i = 0; i < parts; i++) {
      onStatus?.(`Mengunduh ${i + 1}/${parts}…`);
      let r = await fetch(`/api/assets/${id}/pack?part=${i}`, { cache: "no-store" });
      if (!r.ok) r = await fetch(`/api/assets/${id}/pack?part=${i}&retry=1`, { cache: "no-store" });
      if (!r.ok) throw new Error(`Unduh paket gagal (${r.status})`);
      const chunk = new Uint8Array(await r.arrayBuffer());
      out.set(chunk, at);
      at += chunk.length;
    }
    return out;
  }
}

export const safeName = (name: string, fallback = "model") =>
  name.replace(/[^\p{L}\p{N}\- ]+/gu, "").trim().replace(/\s+/g, "_") || fallback;

export async function downloadPack(asset: Pick<Asset, "id" | "name">, onStatus?: (msg: string) => void) {
  const data = await fetchPack(asset.id, onStatus);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([data as BlobPart], { type: "application/zip" }));
  a.download = `${safeName(asset.name, asset.id)}_siap_jual.zip`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/** Upload the user's fixed .blend; the web uses it for .BLEND downloads and the package from now on. */
export async function uploadFixedBlend(id: string, file: File, onProgress?: (p: number) => void): Promise<Asset> {
  if (!file.name.toLowerCase().endsWith(".blend")) throw new Error("Pilih file .blend.");
  const fd = new FormData();
  await appendFile(fd, "file", file, file.name, onProgress);
  const res = await fetch(`/api/assets/${id}/blend`, { method: "POST", body: fd });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error || `Upload gagal (${res.status})`);
  return body as Asset;
}
