"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Archive, BookOpen, Image as ImageIcon, Layers, Palette, ScanLine, Sparkles, Zap } from "lucide-react";
import { formatBytes, useConfig } from "@/lib/useConfig";
import { ENGINE_LABELS } from "@/lib/presets";

const NAV = [
  { href: "/?mode=text", label: "Text to 3D", icon: Sparkles, match: (p: string, m: string | null) => p === "/" && m !== "image" },
  { href: "/?mode=image", label: "Image to 3D", icon: ImageIcon, match: (p: string, m: string | null) => p === "/" && m === "image" },
  { href: "/batch", label: "Batch Synthesis", icon: Layers, phase: 2 },
  { href: "/topology", label: "Topology & Retopo", icon: ScanLine, phase: 2 },
  { href: "/texture", label: "PBR Texture Lab", icon: Palette, phase: 2 },
  { href: "/bridge", label: "Blender Live Sync", icon: Zap, phase: 3 },
  { href: "/library", label: "Knowledge Library", icon: BookOpen },
  { href: "/vault", label: "Asset Vault", icon: Archive },
];

const QUOTA = 2 * 1024 ** 3; // soft local quota shown in the meter

export function Sidebar() {
  const pathname = usePathname();
  const mode = useSearchParams().get("mode");
  const config = useConfig();
  const engine = config?.defaultEngine;
  const used = config?.storage.used ?? 0;

  return (
    <aside className="flex w-14 shrink-0 flex-col justify-between p-2 2xl:w-64">
      <div>
        <p className="label-mono hidden px-1.5 pb-2 pt-2 uppercase tracking-[0.5px] text-dim 2xl:block">Studio Pipelines</p>
        <nav className="flex flex-col gap-0.5">
          {NAV.map((n) => {
            const active = n.match ? n.match(pathname, mode) : pathname === n.href;
            const Icon = n.icon;
            return (
              <Link
                key={n.href}
                href={n.href}
                title={n.label}
                className={`flex h-[30px] items-center justify-center gap-2 rounded-[4px] px-1.5 text-[12px] transition-colors 2xl:justify-start ${
                  active ? "bg-raised text-accent" : "text-dim hover:bg-field hover:text-ink"
                }`}
              >
                <Icon size={14} className="shrink-0" />
                <span className="hidden flex-1 2xl:inline">{n.label}</span>
                {n.phase && <span className="label-mono hidden text-[9px] text-line 2xl:inline">F{n.phase}</span>}
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="hidden rounded-[4px] bg-field p-2 2xl:block">
        <div className="flex items-center justify-between">
          <span className="label-mono uppercase text-dim">AI Engine</span>
          <span className={`label-mono ${engine && engine !== "demo" ? "text-accent" : "text-amber-300"}`}>
            {engine ? (engine === "demo" ? "DEMO" : "READY") : "…"}
          </span>
        </div>
        <p className="mt-1 truncate text-[11px] text-ink">{engine ? ENGINE_LABELS[engine] : "Memuat…"}</p>
        {config?.balance != null && (
          <p className="label-mono mt-0.5 text-accent">Saldo Tripo: {config.balance} kredit</p>
        )}
        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-raised">
          <div className="h-full bg-accent" style={{ width: `${Math.min(100, (used / QUOTA) * 100)}%` }} />
        </div>
        <div className="mt-1.5 flex justify-between">
          <span className="label-mono text-dim">Storage: {formatBytes(used)}</span>
          <span className="label-mono text-dim">{config?.storage.count ?? 0} model</span>
        </div>
      </div>
    </aside>
  );
}
