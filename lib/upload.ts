/**
 * Browser helper: put a file into a FormData field. Small files go inline; bigger ones
 * (> 3.5 MB) are sent first in parts to /api/upload-chunk so they fit hosting limits.
 */
const INLINE_MAX = 3.5 * 1024 * 1024;
const CHUNK = 4 * 1024 * 1024;

export async function appendFile(form: FormData, field: string, file: Blob, name: string, onProgress?: (p: number) => void) {
  if (file.size <= INLINE_MAX) {
    form.append(field, file, name);
    return;
  }
  const id = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("");
  const parts = Math.ceil(file.size / CHUNK);
  for (let i = 0; i < parts; i++) {
    const res = await fetch(`/api/upload-chunk?id=${id}&index=${i}`, { method: "POST", body: file.slice(i * CHUNK, (i + 1) * CHUNK) });
    if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `Upload gagal (${res.status})`);
    onProgress?.((i + 1) / parts);
  }
  form.append(`${field}UploadId`, id);
  form.append(`${field}Name`, name);
  if (file.type) form.append(`${field}Type`, file.type);
}
