import { NextResponse } from "next/server";
import { AUTH_COOKIE, safeEqual, sessionToken } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Slow down guessing a little (per server instance).
const fails = new Map<string, { n: number; until: number }>();

export async function POST(req: Request) {
  const password = process.env.APP_PASSWORD;
  if (!password) return NextResponse.json({ error: "APP_PASSWORD belum diatur di server." }, { status: 503 });

  const ip = req.headers.get("x-nf-client-connection-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0] ?? "local";
  const f = fails.get(ip);
  if (f && f.until > Date.now()) return NextResponse.json({ error: "Terlalu banyak percobaan. Tunggu sebentar." }, { status: 429 });

  const { password: given = "" } = (await req.json().catch(() => ({}))) as { password?: string };
  if (!safeEqual(await sessionToken(String(given)), await sessionToken(password))) {
    const n = (f?.n ?? 0) + 1;
    fails.set(ip, { n, until: n >= 5 ? Date.now() + 60_000 : 0 });
    return NextResponse.json({ error: "Password salah." }, { status: 401 });
  }
  fails.delete(ip);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(AUTH_COOKIE, await sessionToken(password), {
    httpOnly: true,
    sameSite: "lax",
    secure: new URL(req.url).protocol === "https:",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}
