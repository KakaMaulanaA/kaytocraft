import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Check the Gemini key (lists models, no quota used) without revealing it. */
export async function GET() {
  const key = process.env.GEMINI_API_KEY?.trim() ?? "";
  const shape = { present: key.length > 0, length: key.length, prefix: key.slice(0, 4) };
  if (!key) return NextResponse.json({ ok: false, shape, hint: "GEMINI_API_KEY belum ada di .env.local (atau server belum di-restart)." });
  const base = process.env.GEMINI_BASE_URL?.replace(/\/$/, "") || "https://generativelanguage.googleapis.com";
  try {
    const res = await fetch(`${base}/v1beta/models?pageSize=200`, { headers: { "x-goog-api-key": key }, cache: "no-store" });
    const body = await res.json().catch(() => null);
    if (!res.ok) return NextResponse.json({ ok: false, shape, http: res.status, message: body?.error?.message ?? res.statusText });
    const models: string[] = (body?.models ?? [])
      .filter((m: { supportedGenerationMethods?: string[] }) => m.supportedGenerationMethods?.includes("generateContent"))
      .map((m: { name: string }) => m.name.replace(/^models\//, ""))
      .filter((n: string) => /flash|pro/.test(n));
    return NextResponse.json({ ok: true, shape, configuredModel: process.env.GEMINI_MODEL ?? "(otomatis)", models });
  } catch (e) {
    return NextResponse.json({ ok: false, shape, message: e instanceof Error ? e.message : String(e) });
  }
}
