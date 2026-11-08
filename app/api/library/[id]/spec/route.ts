import { readLibFile, validId } from "@/lib/server/library";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const buf = validId(id) ? await readLibFile(id, "json") : null;
  if (!buf) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(buf), { headers: { "Content-Type": "application/json" } });
}
