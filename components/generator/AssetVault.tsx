"use client";
import { useMemo, useState } from "react";
import { AlertTriangle, Archive, BookPlus, Box, Download, Loader2, RotateCcw, Trash2, Upload } from "lucide-react";
import { useRef } from "react";
import type { Asset, PresetId } from "@/lib/types";
import { PRESETS } from "@/lib/presets";
import { compact, formatBytes, timeAgo, useConfig } from "@/lib/useConfig";
import { downloadBlend } from "@/lib/blendDownload";

interface Props {
  assets: Asset[];
  activeId: string | null;
  onSelect: (a: Asset) => void;
  onDelete: (a: Asset) => void;
  onReuse: (a: Asset) => void;
  onImport: (f: File) => void;
  onSaveToLibrary: (a: Asset) => void;
  storageUsed: number;
}

const FILTERS: { id: "all" | "image" | PresetId; label: string }[] = [
  { id: "all", label: "All" },
  ...PRESETS.map((p) => ({ id: p.id, label: p.label })),
  { id: "image", label: "From Image" },
];

const ENGINE_SHORT: Record<string, string> = {
  "tripo-v3.1": "Tripo3D",
  "tripo-v3.0": "Tripo3D",
  "tripo-p2": "Tripo P2",
  meshy: "Meshy AI",
  demo: "Demo",
};

export function AssetVault({ assets, activeId, onSelect, onDelete, onReuse, onImport, onSaveToLibrary, storageUsed }: Props) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("all");
  const list = useMemo(
    () =>
      assets.filter((a) =>
        filter === "all" ? true : filter === "image" ? a.settings.mode === "image" : a.settings.presets?.includes(filter),
      ),
    [assets, filter],
  );
  const ready = assets.filter((a) => a.status === "ready").length;
  const config = useConfig();
  const hosted = config?.features?.hosted ?? false;
  const blendOk = config?.features?.blend ?? true;

  return (
    <section className="flex h-full w-[320px] shrink-0 flex-col overflow-hidden rounded-[8px] bg-panel shadow-xl">
      <div className="border-b border-white/5 p-3">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-1.5 text-[16px] font-semibold tracking-[-0.16px]">
            <Archive size={15} className="text-accent" /> Asset Vault
          </h2>
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            title="Import .glb / .fbx (mis. hasil dari website Tripo/Meshy)"
            className="flex items-center gap-1 rounded-[4px] bg-field px-2 py-1 text-[11px] text-dim hover:text-ink"
          >
            <Upload size={12} /> Import
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".glb,.fbx"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onImport(f);
              e.target.value = "";
            }}
          />
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`label-mono rounded-[2px] px-1.5 py-0.5 ${
                filter === f.id ? "bg-raised text-accent" : "text-dim hover:text-ink"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto p-2">
        {list.length === 0 && (
          <div className="grid flex-1 place-items-center text-center">
            <div>
              <Box size={28} className="mx-auto mb-2 text-line" />
              <p className="text-[12px] text-dim">Belum ada aset{filter !== "all" ? " di filter ini" : ""}.</p>
            </div>
          </div>
        )}
        {list.map((a) => (
          <AssetCard
            key={a.id}
            asset={a}
            active={a.id === activeId}
            onSelect={() => onSelect(a)}
            onDelete={() => onDelete(a)}
            onReuse={() => onReuse(a)}
            onSaveToLibrary={() => onSaveToLibrary(a)}
            blendOk={blendOk}
          />
        ))}
      </div>

      <div className="border-t border-white/5 bg-strip px-3 py-2">
        <div className="flex justify-between">
          <span className="label-mono text-ink">{hosted ? "Cloud Vault" : "Local Vault"}</span>
          <span className="label-mono text-accent">{formatBytes(storageUsed)}</span>
        </div>
        <div className="mt-1 h-1 overflow-hidden rounded-full bg-raised">
          <div
            className="h-full bg-gradient-to-r from-accent-deep to-violet"
            style={{ width: `${Math.min(100, (storageUsed / (2 * 1024 ** 3)) * 100)}%` }}
          />
        </div>
        <p className="label-mono mt-1 text-dim">{ready} model tersimpan {hosted ? "online (Netlify Blobs)" : "di ./storage"}</p>
      </div>
    </section>
  );
}

function AssetCard({
  asset: a,
  active,
  onSelect,
  onDelete,
  onReuse,
  onSaveToLibrary,
  blendOk,
}: {
  blendOk: boolean;
  asset: Asset;
  active: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onReuse: () => void;
  onSaveToLibrary: () => void;
}) {
  const [blendBusy, setBlendBusy] = useState(false);
  const running = a.status === "queued" || a.status === "running";
  const failed = a.status === "failed";
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => e.key === "Enter" && onSelect()}
      className={`group relative flex gap-2 rounded-[8px] p-1.5 text-left transition-colors ${
        active ? "bg-raised ring-1 ring-accent/30" : "bg-field hover:bg-raised"
      }`}
    >
      <div className="relative grid size-14 shrink-0 place-items-center overflow-hidden rounded-[4px] bg-page">
        {a.hasThumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/api/assets/${a.id}/thumb?v=${a.completedAt ?? 0}`} alt="" className="size-full object-cover" />
        ) : running ? (
          <Loader2 size={18} className="animate-spin text-accent" />
        ) : failed ? (
          <AlertTriangle size={18} className="text-red-400" />
        ) : (
          <Box size={18} className="text-line" />
        )}
        {a.format === "fbx" && (
          <span className="label-mono absolute bottom-0.5 right-0.5 rounded-[2px] bg-page/90 px-0.5 text-[9px] text-violet">
            FBX
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-1">
          <p className="truncate text-[13px] leading-[18px] text-ink">{a.name}</p>
          <span className={`label-mono shrink-0 ${active ? "text-accent" : "text-dim"}`}>
            {active ? "ACTIVE" : a.source === "procedural" ? "Gratis" : a.source === "import" ? "Import" : a.source === "claude" ? "Claude" : a.source === "gemini" ? "Gemini" : a.source === "library" ? "Library" : ENGINE_SHORT[a.settings.engine]}
          </span>
        </div>
        {running ? (
          <>
            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-page">
              <div
                className="h-full bg-gradient-to-r from-accent-deep via-accent to-violet transition-[width] duration-500"
                style={{ width: `${Math.max(3, a.progress)}%` }}
              />
            </div>
            <p className="label-mono mt-1 truncate text-dim">
              {a.progress}% · {a.stageLabel ?? "Memproses"}
            </p>
          </>
        ) : failed ? (
          <p className="label-mono mt-0.5 line-clamp-2 text-red-300" title={a.error}>
            {a.error ?? "Gagal"}
          </p>
        ) : (
          <p className="label-mono mt-0.5 text-dim">
            {a.stats ? `${compact(a.stats.triangles)} Tris` : formatBytes(a.fileSize ?? 0)} • {timeAgo(a.createdAt)}
          </p>
        )}
        <div className="mt-1 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          {a.status === "ready" && (
            <a
              href={`/api/assets/${a.id}/file?download=1`}
              onClick={(e) => e.stopPropagation()}
              className="label-mono flex items-center gap-0.5 rounded-[2px] bg-page px-1 py-0.5 text-dim hover:text-accent"
            >
              <Download size={10} /> .{a.format?.toUpperCase()}
            </a>
          )}
          {a.status === "ready" && blendOk && (
            <IconBtn
              label="Unduh .blend"
              onClick={async () => {
                if (blendBusy) return;
                setBlendBusy(true);
                try {
                  await downloadBlend(a.id, a.name);
                } catch (e) {
                  alert(e instanceof Error ? e.message : String(e));
                } finally {
                  setBlendBusy(false);
                }
              }}
            >
              {blendBusy ? <Loader2 size={10} className="animate-spin" /> : <Download size={10} />} .BLEND
            </IconBtn>
          )}
          {(a.settings.mode === "text" || a.conceptId) && (
            <IconBtn label="Pakai prompt ini lagi" onClick={onReuse}>
              <RotateCcw size={10} /> Reuse
            </IconBtn>
          )}
          {a.status === "ready" && (
            <IconBtn label="Simpan ke Knowledge Library" onClick={onSaveToLibrary}>
              <BookPlus size={10} /> Library
            </IconBtn>
          )}
          {!running && (
            <IconBtn label="Hapus" onClick={onDelete} danger>
              <Trash2 size={10} />
            </IconBtn>
          )}
        </div>
      </div>
    </div>
  );
}

function IconBtn(p: { label: string; onClick: () => void; danger?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={p.label}
      onClick={(e) => {
        e.stopPropagation();
        p.onClick();
      }}
      className={`label-mono flex items-center gap-0.5 rounded-[2px] bg-page px-1 py-0.5 text-dim ${
        p.danger ? "hover:text-red-400" : "hover:text-accent"
      }`}
    >
      {p.children}
    </button>
  );
}
