"use client";
import Link from "next/link";
import { Box, LogOut, Settings, User } from "lucide-react";
import { useConfig } from "@/lib/useConfig";

export function Header() {
  const config = useConfig();
  const active = config?.engines.find((e) => e.id === config.defaultEngine);
  const live = active && active.provider !== "demo";
  const statusLabel = !config
    ? "Checking…"
    : live
      ? `${{ tripo: "Tripo3D", meshy: "Meshy", claude: "Claude", gemini: "Gemini", demo: "" }[active!.provider]} API: Connected`
      : "Mode Gratis (tanpa API key)";

  return (
    <header className="flex h-14 items-center justify-between border-b border-white/5 bg-page px-4">
      <div className="flex items-center gap-3">
        <Link href="/" className="flex items-center gap-2">
          <span className="grid size-8 place-items-center rounded-lg bg-gradient-to-br from-accent-deep to-violet text-on-accent">
            <Box size={18} strokeWidth={2.2} />
          </span>
          <span className="text-[16px] font-semibold tracking-[-0.16px] text-ink">KaytoCraft 3D</span>
        </Link>
        <span className="label-mono rounded-[2px] border border-line bg-field px-1.5 py-0.5 text-dim">
          {config?.features?.hosted ? "ONLINE" : "INTERNAL TOOL"} V0.2
        </span>
        <span className="mx-1 h-4 w-px bg-line" />
        <span className="flex items-center gap-1.5 rounded-full bg-field px-2 py-0.5">
          <span className={`size-2 rounded-full ${live ? "bg-accent" : "bg-amber-400"}`} />
          <span className={`label-mono ${live ? "text-accent" : "text-amber-300"}`}>{statusLabel}</span>
        </span>
      </div>

      <div className="flex items-center gap-4">
        <nav className="flex items-center gap-3 text-[12px] text-dim">
          <a
            href="https://docs.blender.org/manual/en/latest/addons/import_export/scene_gltf2.html"
            target="_blank"
            rel="noreferrer"
            className="hover:text-ink"
          >
            Blender glTF Import Docs
          </a>
          <Link href="/bridge" className="hover:text-ink">
            Bridge Settings
          </Link>
        </nav>
        <button className="grid size-6 place-items-center rounded text-dim hover:bg-field hover:text-ink" aria-label="Settings">
          <Settings size={15} />
        </button>
        {config?.features?.auth && (
          <button
            onClick={async () => {
              await fetch("/api/auth/logout", { method: "POST" });
              window.location.href = "/login";
            }}
            className="grid size-6 place-items-center rounded text-dim hover:bg-field hover:text-ink"
            aria-label="Keluar"
            title="Keluar"
          >
            <LogOut size={15} />
          </button>
        )}
        <span className="grid size-8 place-items-center rounded-lg bg-accent text-on-accent shadow-[0_10px_15px_-3px_rgba(78,222,163,0.2)]">
          <User size={16} />
        </span>
      </div>
    </header>
  );
}
