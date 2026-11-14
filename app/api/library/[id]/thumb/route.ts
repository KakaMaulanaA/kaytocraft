import { readLibFile, updateEntry, validId, writeLibFile } from "@/lib/server/library";
import { imageType } from "@/lib/server/http";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const buf = validId(id) ? await readLibFile(id, "png") : null;
  if (!buf) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(buf), { headers: { "Content-Type": "image/png", "Cache-Control": "no-cache" } });
}

export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  if (!validId(id)) return new Response(null, { status: 404 });
  const buf = Buffer.from(await req.arrayBuffer());
  if (buf.byteLength > 3 * 1024 * 1024) return new Response("Too large", { status: 413 });
  if (imageType(buf) !== "png") return new Response("Thumbnail harus PNG", { status: 400 });
  await writeLibFile(id, "png", buf);
  await updateEntry(id, { hasThumb: true });
  return Response.json({ ok: true });
}
