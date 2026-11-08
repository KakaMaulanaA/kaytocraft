"use client";
import { useCallback, useEffect, useState } from "react";
import type { AppConfig } from "./types";

const EVENT = "kc:config-refresh";

/** Ask every mounted useConfig() to refetch (e.g. after a generation finishes). */
export function refreshConfig() {
  window.dispatchEvent(new Event(EVENT));
}

export function useConfig() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/config", { cache: "no-store" });
      if (res.ok) setConfig(await res.json());
    } catch {}
  }, []);
  useEffect(() => {
    load();
    window.addEventListener(EVENT, load);
    return () => window.removeEventListener(EVENT, load);
  }, [load]);
  return config;
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export function timeAgo(ts: number) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return "baru saja";
  if (s < 3600) return `${Math.floor(s / 60)}m lalu`;
  if (s < 86400) return `${Math.floor(s / 3600)}j lalu`;
  if (s < 172800) return "kemarin";
  return `${Math.floor(s / 86400)}h lalu`;
}

export function compact(n: number) {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n);
}
