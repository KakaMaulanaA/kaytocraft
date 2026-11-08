import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Check the Anthropic key without spending credits (lists models) and without revealing it. */
export async function GET() {
  const raw = process.env.ANTHROPIC_API_KEY ?? "";
  const key = raw.trim();
  const configured = process.env.ANTHROPIC_MODEL?.trim() || "claude-sonnet-5-5";
  const shape = {
    present: key.length > 0,
    length: key.length,
    prefix: key.slice(0, 10),
    looksTruncated: key.includes("...") || key.includes("…"),
    hasWhitespaceOrQuotes: raw !== key || /[\s"']/.test(key),
  };
  if (!key) return NextResponse.json({ ok: false, shape, hint: "ANTHROPIC_API_KEY belum ada di .env.local (atau server belum di-restart)." });

  try {
    const base = process.env.ANTHROPIC_BASE_URL?.replace(/\/$/, "") || "https://api.anthropic.com";
    const res = await fetch(`${base}/v1/models?limit=100`, {
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
      cache: "no-store",
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      return NextResponse.json({
        ok: false,
        shape,
        http: res.status,
        message: body?.error?.message ?? res.statusText,
        hint: res.status === 401 ? "Key ditolak: salah salin / terpotong / sudah dihapus. Buat key baru." : undefined,
      });
    }
    const models: string[] = (body?.data ?? []).map((m: { id: string }) => m.id);
    return NextResponse.json({
      ok: true,
      shape,
      configuredModel: configured,
      configuredModelAvailable: models.includes(configured),
      models,
      note: "Key valid. Saldo/kredit tidak bisa dicek lewat API; lihat Billing di console.anthropic.com.",
    });
  } catch (e) {
    return NextResponse.json({ ok: false, shape, message: e instanceof Error ? e.message : String(e) });
  }
}
