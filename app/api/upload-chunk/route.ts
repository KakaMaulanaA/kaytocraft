import { CHUNK_MAX, UPLOAD_MAX_PARTS, savePart, validUploadId } from "@/lib/server/uploads";
import { workerAuthorized } from "@/lib/server/blendRemote";

export const dynamic = "force-dynamic";

/** POST raw bytes: /api/upload-chunk?id=<16 hex>&index=<n> */
export async function POST(req: Request) {
  // A request carrying the worker header got past the login only because of it: verify it.
  if (req.headers.get("x-worker-secret") && !workerAuthorized(req)) return Response.json({ error: "forbidden" }, { status: 403 });
  const url = new URL(req.url);
  const id = url.searchParams.get("id") ?? "";
  const index = Number(url.searchParams.get("index"));
  if (!validUploadId(id) || !Number.isInteger(index) || index < 0 || index >= UPLOAD_MAX_PARTS)
    return Response.json({ error: "Parameter upload tidak valid." }, { status: 400 });
  const buf = Buffer.from(await req.arrayBuffer());
  if (!buf.byteLength || buf.byteLength > CHUNK_MAX + 1024) return Response.json({ error: "Potongan upload tidak valid." }, { status: 413 });
  await savePart(id, index, buf);
  return Response.json({ ok: true });
}
