import { findThumb, getAsset, saveBuffer, updateAsset } from "@/lib/server/storage";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

const TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" };

export async function GET(_req: Request, { params }: Ctx) {
  const t = await findThumb((await params).id);
  if (!t) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(t.buf), {
    headers: { "Content-Type": TYPES[t.key.split(".").pop()!] ?? "image/png", "Cache-Control": "no-cache" },
  });
}

/** Viewer uploads a PNG snapshot when the provider gave no preview image. */
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const asset = await getAsset(id);
  if (!asset) return new Response("Not found", { status: 404 });
  const buf = Buffer.from(await req.arrayBuffer());
  if (buf.byteLength > 2 * 1024 * 1024) return new Response("Too large", { status: 413 });
  await saveBuffer(`thumbs/${id}.png`, buf);
  await updateAsset(id, { hasThumb: true });
  return Response.json({ ok: true });
}
