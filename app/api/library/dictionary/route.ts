import { NextResponse } from "next/server";
import { setWord } from "@/lib/server/library";

export const dynamic = "force-dynamic";

/** Add / change a word: { word: "lemari jati", english: "teak wardrobe" } (empty english removes it). */
export async function POST(req: Request) {
  const { word, english } = (await req.json()) as { word?: string; english?: string };
  if (!word?.trim()) return NextResponse.json({ error: "Kata masih kosong." }, { status: 400 });
  return NextResponse.json(await setWord(word.slice(0, 60), english ? english.slice(0, 120) : null));
}
