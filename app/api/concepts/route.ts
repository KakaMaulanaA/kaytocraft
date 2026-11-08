import { NextResponse } from "next/server";
import { createConcepts, getConcept, pollConcept } from "@/lib/server/concepts";
import { engineList } from "@/lib/server/providers";
import type { EngineId } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Start 1–4 concept images for a prompt. */
export async function POST(req: Request) {
  const body = (await req.json()) as { prompt?: string; engine?: EngineId; count?: number };
  const prompt = String(body.prompt ?? "").trim().slice(0, 1000);
  if (!prompt) return NextResponse.json({ error: "Prompt masih kosong." }, { status: 400 });
  const engine = engineList().find((e) => e.id === body.engine);
  if (!engine?.available) return NextResponse.json({ error: "Engine belum aktif." }, { status: 400 });
  if (!engine.supportsConcept)
    return NextResponse.json({ error: `${engine.label} belum mendukung konsep 2D.` }, { status: 400 });
  try {
    const list = await createConcepts({ prompt, engine: engine.id, count: body.count ?? 2 });
    return NextResponse.json(list);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}

/** Poll several concepts at once: /api/concepts?ids=a,b,c */
export async function GET(req: Request) {
  const ids = (new URL(req.url).searchParams.get("ids") ?? "").split(",").filter(Boolean).slice(0, 8);
  const out = await Promise.all(
    ids.map(async (id) => {
      const c = await getConcept(id);
      if (!c) return null;
      try {
        return await pollConcept(c);
      } catch (e) {
        return { ...c, progressNote: e instanceof Error ? e.message : String(e) };
      }
    }),
  );
  return NextResponse.json(out.filter(Boolean));
}
