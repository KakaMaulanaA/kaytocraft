import "server-only";
import { storageStore } from "./blobstore";

/**
 * Chunked uploads: Netlify functions accept ~6 MB per request, so the browser sends
 * bigger files in parts to /api/upload-chunk, then passes `<field>UploadId` + `<field>Name`
 * in the form instead of the file itself.
 */
export const CHUNK_MAX = 4 * 1024 * 1024;
export const UPLOAD_MAX_PARTS = 64; // 256 MB
export const validUploadId = (id: string) => /^[a-f0-9]{16}$/.test(id);
const partKey = (id: string, i: number) => `tmp/${id}/${String(i).padStart(3, "0")}`;

export async function savePart(id: string, index: number, buf: Buffer) {
  await storageStore().set(partKey(id, index), buf);
}

export async function assemble(id: string, maxBytes: number): Promise<Buffer> {
  const keys = (await storageStore().list(`tmp/${id}/`)).sort();
  if (!keys.length) throw new Error("Upload tidak ditemukan / kedaluwarsa. Coba unggah lagi.");
  const parts: Buffer[] = [];
  let total = 0;
  for (const [i, k] of keys.entries()) {
    if (k !== partKey(id, i)) throw new Error("Upload tidak lengkap. Coba unggah lagi.");
    const b = await storageStore().get(k);
    if (!b) throw new Error("Upload tidak lengkap. Coba unggah lagi.");
    total += b.byteLength;
    if (total > maxBytes) throw new Error("File terlalu besar.");
    parts.push(b);
  }
  await Promise.all(keys.map((k) => storageStore().del(k)));
  return Buffer.concat(parts);
}

/** Read a file field from a form, either sent directly or via chunked upload. */
export async function takeFile(form: FormData, field: string, maxBytes: number): Promise<{ name: string; type: string; buf: Buffer } | null> {
  const f = form.get(field);
  if (f instanceof File) {
    if (f.size > maxBytes) throw new Error("File terlalu besar.");
    return { name: f.name, type: f.type, buf: Buffer.from(await f.arrayBuffer()) };
  }
  const id = String(form.get(`${field}UploadId`) ?? "");
  if (!id) return null;
  if (!validUploadId(id)) throw new Error("uploadId tidak valid.");
  return {
    name: String(form.get(`${field}Name`) ?? "upload.bin").slice(0, 200),
    type: String(form.get(`${field}Type`) ?? ""),
    buf: await assemble(id, maxBytes),
  };
}
