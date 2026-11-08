import { getConcept, readConceptImage } from "@/lib/server/concepts";

export const dynamic = "force-dynamic";

const TYPES = { png: "image/png", jpg: "image/jpeg", svg: "image/svg+xml" } as const;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await getConcept((await params).id);
  const buf = c && c.status === "ready" && c.ext ? await readConceptImage(c) : null;
  if (!c || !buf) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(buf), {
    headers: { "Content-Type": TYPES[c.ext!], "Cache-Control": "private, max-age=31536000, immutable" },
  });
}
