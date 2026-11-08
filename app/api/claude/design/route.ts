import { NextResponse } from "next/server";
import { DesignError, designWithClaude } from "@/lib/server/design";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Kept for compatibility; new code uses /api/design with { engine }. */
export async function POST(req: Request) {
  const body = (await req.json()) as { prompt?: string; image?: { mediaType?: string; data?: string } };
  const prompt = String(body.prompt ?? "").trim().slice(0, 2000);
  const img = body.image?.data ? { mediaType: String(body.image.mediaType), data: body.image.data } : undefined;
  if (!prompt && !img) return NextResponse.json({ error: "Prompt atau gambar masih kosong." }, { status: 400 });
  try {
    return NextResponse.json(await designWithClaude({ prompt, image: img }));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: e instanceof DesignError ? e.status : 500 });
  }
}
