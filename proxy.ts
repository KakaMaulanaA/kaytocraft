import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE, authRequired, safeEqual, sessionToken } from "@/lib/auth";

/**
 * Password login. Off on the local PC unless APP_PASSWORD is set; always on when hosted
 * (Netlify) so the AI keys and credits are not open to the internet.
 */
export async function proxy(req: NextRequest) {
  if (!authRequired()) return NextResponse.next();
  const { pathname } = req.nextUrl;
  // Netlify's own endpoints (background functions etc.) are not pages of this app.
  if (pathname.startsWith("/.netlify/")) return NextResponse.next();

  // Always reachable: the login page/API, and model files by their random id
  // (the "Python Script" export fetches the model from inside Blender, which has no cookie).
  if (pathname === "/login" || pathname.startsWith("/api/auth/")) return NextResponse.next();
  if (req.method === "GET" && /^\/api\/assets\/[a-f0-9]{12}\/file$/.test(pathname)) return NextResponse.next();
  // The GitHub Actions .blend worker (checked again, constant-time, inside the routes).
  if (
    req.method === "POST" &&
    req.headers.get("x-worker-secret") &&
    (pathname === "/api/upload-chunk" || /^\/api\/assets\/[a-f0-9]{12}\/blend$/.test(pathname))
  )
    return NextResponse.next();

  const password = process.env.APP_PASSWORD;
  if (!password) {
    return new NextResponse(
      "KaytoCraft 3D: APP_PASSWORD belum diatur. Tambahkan di Netlify > Site configuration > Environment variables, lalu deploy ulang.",
      { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } },
    );
  }
  const cookie = req.cookies.get(AUTH_COOKIE)?.value ?? "";
  if (cookie && safeEqual(cookie, await sessionToken(password))) return NextResponse.next();

  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Belum login." }, { status: 401 });
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + req.nextUrl.search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|\\.netlify/|favicon.ico|demo/|fonts/).*)"],
};
