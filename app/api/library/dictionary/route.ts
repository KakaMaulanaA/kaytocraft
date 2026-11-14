import { NextResponse } from "next/server";
import { setWord } from "@/lib/server/library";
import { badJson, readJson } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** Add / change a word: { word: "lemari jati", english: "teak wardrobe" } (empty english removes it). */
export async function POST(req: Request) {
  const body = await readJson<{ word?: unknown; english?: unknown }>(req);
  if (!body) return badJson();
  const word = typeof body.word === "string" ? body.word : "";
  const english = typeof body.english === "string" ? body.english : "";
  if (!word.trim()) return NextResponse.json({ error: "Kata masih kosong." }, { status: 400 });
  return NextResponse.json(await setWord(word.slice(0, 60), english ? english.slice(0, 120) : null));
}
