"use client";
import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

/**
 * After a new deploy, a tab opened earlier can't load the new code chunks (3D viewer,
 * thumbnails, pages). Instead of things silently failing, offer a reload.
 */
const STALE = /ChunkLoadError|Loading chunk|Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i;

export function UpdateBanner() {
  const [stale, setStale] = useState(false);
  useEffect(() => {
    const check = (msg: unknown) => {
      const text = msg instanceof Error ? `${msg.name} ${msg.message}` : String(msg ?? "");
      if (STALE.test(text)) setStale(true);
    };
    const onErr = (e: ErrorEvent) => check(e.error ?? e.message);
    const onRej = (e: PromiseRejectionEvent) => check(e.reason);
    window.addEventListener("error", onErr);
    window.addEventListener("unhandledrejection", onRej);
    (window as unknown as { __kcStale?: (e: unknown) => void }).__kcStale = check;
    return () => {
      window.removeEventListener("error", onErr);
      window.removeEventListener("unhandledrejection", onRej);
    };
  }, []);
  if (!stale) return null;
  return (
    <div className="fixed inset-x-0 top-0 z-[60] flex items-center justify-center gap-3 bg-violet px-3 py-2 text-[13px] text-page shadow-lg">
      <span>Versi web baru sudah tersedia — muat ulang halaman supaya semua fitur jalan.</span>
      <button type="button" onClick={() => window.location.reload()} className="flex items-center gap-1 rounded bg-page/90 px-2 py-0.5 text-ink">
        <RefreshCw size={13} /> Muat ulang
      </button>
    </div>
  );
}
