import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Diagnose a Tripo API key without ever revealing it:
 * checks its shape and asks each known Tripo endpoint whether it accepts the key.
 */
const PROBES = [
  { name: "tripo3d.ai v3", base: "https://openapi.tripo3d.ai/v3", url: "https://openapi.tripo3d.ai/v3/account/balance" },
  { name: "tripo3d.com v3", base: "https://openapi.tripo3d.com/v3", url: "https://openapi.tripo3d.com/v3/account/balance" },
  { name: "tripo3d.ai v2 (legacy)", base: "https://api.tripo3d.ai/v2/openapi", url: "https://api.tripo3d.ai/v2/openapi/user/balance" },
];

export async function GET() {
  const raw = process.env.TRIPO_API_KEY ?? "";
  const key = raw.trim();
  const shape = {
    present: key.length > 0,
    length: key.length,
    prefix: key.slice(0, 4),
    hasWhitespace: raw !== key || /\s/.test(key),
    hasQuotes: /^["']|["']$/.test(key),
    configuredBase: process.env.TRIPO_API_BASE || "(default) https://openapi.tripo3d.ai/v3",
  };
  if (!key) return NextResponse.json({ shape, results: [] });

  const results = await Promise.all(
    PROBES.map(async (p) => {
      try {
        const res = await fetch(p.url, { headers: { Authorization: `Bearer ${key.replace(/^["']|["']$/g, "")}` }, cache: "no-store" });
        const text = await res.text();
        let body: any = null;
        try {
          body = JSON.parse(text);
        } catch {}
        return {
          endpoint: p.name,
          base: p.base,
          http: res.status,
          accepted: res.ok && (body?.code === undefined || body.code === 0),
          message: body?.message ?? null,
          balance: body?.data?.balance ?? null,
        };
      } catch (e) {
        return { endpoint: p.name, base: p.base, http: 0, accepted: false, message: e instanceof Error ? e.message : String(e) };
      }
    }),
  );
  return NextResponse.json({ shape, results });
}
