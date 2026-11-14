import { NextResponse } from "next/server";
import { removeEntry, updateEntry, validId } from "@/lib/server/library";
import { parseKeywords } from "@/lib/library";
import { badJson, readJson } from "@/lib/server/http";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  if (!validId(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await readJson<{ label?: string; keywords?: string }>(req);
  if (!body) return badJson();
  const patch: { label?: string; keywords?: string[] } = {};
  if (typeof body.label === "string" && body.label.trim()) patch.label = body.label.trim().slice(0, 80);
  if (typeof body.keywords === "string") {
    const k = parseKeywords(body.keywords);
    if (k.length) patch.keywords = k;
  }
  const e = await updateEntry(id, patch);
  return e ? NextResponse.json(e) : NextResponse.json({ error: "Not found" }, { status: 404 });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  if (!validId(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const e = await removeEntry(id);
  return e ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Not found" }, { status: 404 });
}
