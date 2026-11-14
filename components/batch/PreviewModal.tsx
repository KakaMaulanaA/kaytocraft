"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Download, ExternalLink, Loader2, X } from "lucide-react";
import type { ModelViewer } from "@/lib/three/viewer";

/**
 * Quick 3D preview inside the Batch page (the queue keeps running behind it).
 * Also fills in a missing thumbnail from the rendered view.
 */
export function PreviewModal(props: {
  assetId: string;
  name: string;
  format?: "glb" | "fbx";
  hasThumb?: boolean;
  onClose: () => void;
  onThumb?: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<{ loading: boolean; error?: string; tris?: number }>({ loading: true });

  useEffect(() => {
    let viewer: ModelViewer | null = null;
    let dead = false;
    (async () => {
      try {
        const { ModelViewer } = await import("@/lib/three/viewer");
        if (dead || !host.current) return;
        viewer = new ModelViewer(host.current);
        viewer.onContextLost = () => !dead && setState({ loading: false, error: "tampilan 3D terputus — tutup lalu buka lagi" });
        const url = `/api/assets/${props.assetId}/file`;
        const fmt = props.format ?? "glb";
        const stats = await viewer.load(url, fmt).catch(async () => {
          await new Promise((r) => setTimeout(r, 1200));
          return viewer!.load(`${url}?retry=1`, fmt);
        });
        if (dead) return;
        setState({ loading: false, tris: stats.triangles });
        if (!props.hasThumb) {
          await new Promise((r) => setTimeout(r, 300));
          const png = await viewer.snapshot();
          if (png && !dead) {
            const r = await fetch(`/api/assets/${props.assetId}/thumb`, { method: "POST", body: png }).catch(() => null);
            if (r?.ok) props.onThumb?.();
          }
        }
      } catch (e) {
        if (!dead) setState({ loading: false, error: e instanceof Error ? e.message : String(e) });
      }
    })();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && props.onClose();
    window.addEventListener("keydown", esc);
    return () => {
      dead = true;
      window.removeEventListener("keydown", esc);
      viewer?.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.assetId]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-3 backdrop-blur-sm" onClick={props.onClose}>
      <div
        role="dialog"
        aria-label={`Pratinjau ${props.name}`}
        className="flex h-[min(80vh,640px)] w-full max-w-[860px] flex-col overflow-hidden rounded-[12px] bg-panel shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-white/5 px-3 py-2">
          <p className="min-w-0 flex-1 truncate text-[14px] font-semibold text-ink">{props.name}</p>
          {state.tris != null && <span className="label-mono text-dim">{state.tris.toLocaleString()} tris</span>}
          <button type="button" onClick={props.onClose} aria-label="Tutup" className="grid size-8 place-items-center rounded text-dim hover:bg-raised hover:text-ink">
            <X size={16} />
          </button>
        </div>
        <div className="relative min-h-0 flex-1 bg-[rgba(2,6,23,0.8)]">
          <div ref={host} className="absolute inset-0" />
          {(state.loading || state.error) && (
            <div className="absolute inset-0 grid place-items-center">
              {state.loading ? (
                <span className="flex items-center gap-2 text-[12px] text-dim">
                  <Loader2 size={16} className="animate-spin" /> Memuat model…
                </span>
              ) : (
                <span className="max-w-xs text-center text-[12px] text-red-300">Gagal memuat model: {state.error}</span>
              )}
            </div>
          )}
        </div>
        <div className="flex flex-wrap justify-end gap-2 border-t border-white/5 p-2">
          <a href={`/api/assets/${props.assetId}/file?download=1`} className="btn-secondary flex items-center gap-1.5 text-[12px]">
            <Download size={13} /> Unduh .{(props.format ?? "glb").toUpperCase()}
          </a>
          <Link href={`/?asset=${props.assetId}`} className="btn-primary flex items-center gap-1.5 text-[12px]">
            <ExternalLink size={13} /> Buka di Generator
          </Link>
        </div>
      </div>
    </div>
  );
}
