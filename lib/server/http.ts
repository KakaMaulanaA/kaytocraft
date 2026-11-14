// Server code only.

/** Parse a JSON request body; a broken or empty body becomes `null` instead of a 500 error. */
export async function readJson<T = Record<string, unknown>>(req: Request): Promise<T | null> {
  try {
    const v = await req.json();
    return v && typeof v === "object" ? (v as T) : null;
  } catch {
    return null;
  }
}

export const badJson = () => Response.json({ error: "Data permintaan tidak valid (bukan JSON)." }, { status: 400 });

/** Quick format checks on uploaded bytes (the file name alone can lie). */
export function looksLikeModel(buf: Buffer, ext: "glb" | "fbx") {
  if (ext === "glb") return buf.byteLength >= 12 && buf.subarray(0, 4).toString("latin1") === "glTF";
  const head = buf.subarray(0, 64).toString("latin1");
  return head.startsWith("Kaydara FBX Binary") || /^\s*;\s*FBX/.test(head);
}

export function imageType(buf: Buffer): "png" | "jpg" | "webp" | null {
  if (buf.byteLength >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (buf.byteLength >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  if (buf.byteLength >= 12 && buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP") return "webp";
  return null;
}
