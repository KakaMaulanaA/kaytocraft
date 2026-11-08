"use client";
import { AlertTriangle, ArrowRight, Loader2, RefreshCw, X } from "lucide-react";
import type { Concept } from "@/lib/types";

interface Props {
  concepts: Concept[];
  prompt: string;
  cost3D: string | null; // e.g. "≈30 kr · $0.30"
  busy: boolean;
  onPick: (c: Concept) => void;
  onRetry: () => void;
  onClose: () => void;
}

/** Step between prompt and 3D: pick the 2D concept that matches what you want. */
export function ConceptBoard({ concepts, prompt, cost3D, busy, onPick, onRetry, onClose }: Props) {
  const running = concepts.some((c) => c.status === "running");
  const ready = concepts.filter((c) => c.status === "ready").length;

  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-[rgba(10,14,23,0.94)] p-4 backdrop-blur-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="label-mono uppercase tracking-[0.5px] text-accent">Langkah 1 / 2 · Pilih Konsep</p>
          <h3 className="mt-0.5 text-[16px] font-semibold tracking-[-0.16px]">
            {running ? "Membuat konsep 2D…" : ready ? "Pilih konsep yang paling sesuai" : "Konsep gagal dibuat"}
          </h3>
          <p className="label-mono mt-1 line-clamp-2 text-dim" title={prompt}>
            {prompt}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onRetry}
            disabled={running || busy}
            className="flex items-center gap-1 rounded-[4px] bg-field px-2 py-1 text-[12px] text-dim hover:text-ink disabled:opacity-40"
          >
            <RefreshCw size={12} /> Buat ulang
          </button>
          <button
            type="button"
            onClick={onClose}
            className="grid size-7 place-items-center rounded-[4px] text-dim hover:bg-field hover:text-ink"
            aria-label="Tutup papan konsep"
          >
            <X size={15} />
          </button>
        </div>
      </div>

      <div
        className={`mt-3 grid min-h-0 flex-1 gap-2 ${concepts.length === 1 ? "grid-cols-1" : "grid-cols-2"} auto-rows-fr`}
      >
        {concepts.map((c, i) => (
          <div key={c.id} className="group relative flex min-h-0 flex-col overflow-hidden rounded-[8px] border border-line bg-[#f4f4f2]">
            {c.status === "ready" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/api/concepts/${c.id}/image`} alt={`Konsep ${i + 1}`} className="min-h-0 flex-1 object-contain" />
            ) : (
              <div className="grid flex-1 place-items-center bg-field">
                {c.status === "running" ? (
                  <span className="flex flex-col items-center gap-2 text-dim">
                    <Loader2 size={20} className="animate-spin text-accent" />
                    <span className="label-mono">{c.progress}%</span>
                  </span>
                ) : (
                  <span className="flex max-w-[90%] flex-col items-center gap-1 text-center text-red-300">
                    <AlertTriangle size={18} />
                    <span className="label-mono line-clamp-3">{c.error ?? "Gagal"}</span>
                  </span>
                )}
              </div>
            )}
            <span className="label-mono absolute left-1.5 top-1.5 rounded-[2px] bg-page/80 px-1 text-ink">#{i + 1}</span>
            {c.status === "ready" && (
              <button
                type="button"
                disabled={busy}
                onClick={() => onPick(c)}
                className="absolute inset-x-2 bottom-2 flex items-center justify-center gap-1 rounded-[6px] bg-accent py-1.5 text-[12px] font-semibold text-on-accent shadow-lg transition hover:brightness-110 disabled:opacity-50"
              >
                Jadikan 3D <ArrowRight size={12} />
                {cost3D && <span className="font-mono text-[10px] font-normal opacity-80">({cost3D})</span>}
              </button>
            )}
          </div>
        ))}
      </div>

      <p className="label-mono mt-2 text-dim">
        Tips: pilih gambar yang objeknya utuh, satu benda, dan bentuknya paling jelas. Tidak ada yang cocok? Ubah prompt
        lalu buat ulang — jauh lebih murah daripada mengulang 3D.
      </p>
    </div>
  );
}
