"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Download,
  Eye,
  FileSpreadsheet,
  Layers,
  Loader2,
  Play,
  RotateCcw,
  Square,
  Trash2,
  Upload,
} from "lucide-react";
import { parseListText, readListFile } from "@/lib/listFile";
import { makeOne, type BatchEngine } from "@/lib/batch";
import { useLibrary } from "@/lib/useLibrary";
import { refreshConfig, useConfig } from "@/lib/useConfig";
import { TRIPO_COST } from "@/lib/estimate";

type RowStatus = "waiting" | "running" | "done" | "failed";
interface Row {
  key: string;
  prompt: string;
  status: RowStatus;
  via?: string;
  assetId?: string;
  name?: string;
  hasThumb?: boolean;
  error?: string;
  secs?: number;
}

const ROWS_KEY = "kc:batch:v1";
const MAX_ITEMS = 200;

const ENGINES: { id: BatchEngine; label: string; sub: string }[] = [
  { id: "auto", label: "Otomatis (gratis)", sub: "Library → Mode Gratis → Gemini" },
  { id: "gemini", label: "Gemini", sub: "gratis, kuota harian Google" },
  { id: "claude", label: "Claude", sub: "berbayar per token" },
  { id: "tripo", label: "Tripo3D", sub: `berbayar, ${TRIPO_COST.text} kredit / barang` },
];

const VIA_LABEL: Record<string, string> = {
  library: "Library",
  procedural: "Gratis",
  gemini: "Gemini",
  claude: "Claude",
  tripo: "Tripo3D",
};

export function BatchStudio() {
  const config = useConfig();
  const library = useLibrary();
  const [text, setText] = useState("");
  const [engine, setEngine] = useState<BatchEngine>("auto");
  const [rows, setRows] = useState<Row[]>([]);
  const [running, setRunning] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [zipping, setZipping] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const has = (id: string) => !!config?.engines.find((e) => e.id === id)?.available;
  const gemini = has("gemini");
  const claude = has("claude");
  const tripo = !!config?.engines.find((e) => e.provider === "tripo" && e.available);
  const available = (id: BatchEngine) => (id === "auto" ? true : id === "tripo" ? tripo : has(id));

  // Keep the last batch across reloads (results live in the vault anyway).
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(ROWS_KEY) || "null") as Row[] | null;
      if (saved?.length) setRows(saved.map((r) => (r.status === "running" ? { ...r, status: "waiting" } : r)));
    } catch {}
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(ROWS_KEY, JSON.stringify(rows));
    } catch {}
  }, [rows]);

  // Leaving the page stops the queue (it runs in this tab).
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (abort.current && !abort.current.signal.aborted) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  const items = useMemo(() => parseListText(text).slice(0, MAX_ITEMS), [text]);
  const pending = rows.filter((r) => r.status === "waiting").length;
  const done = rows.filter((r) => r.status === "done").length;
  const failed = rows.filter((r) => r.status === "failed").length;

  async function pickFile(f: File | null) {
    if (!f) return;
    setMsg(null);
    try {
      const list = await readListFile(f);
      if (!list.length) throw new Error("Tidak ada nama barang yang terbaca di file itu.");
      setText(list.join("\n"));
      setMsg({ ok: true, text: `${list.length} barang terbaca dari ${f.name}. Cek daftarnya, lalu klik Proses.` });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    }
  }

  const update = (key: string, patch: Partial<Row>) => setRows((list) => list.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  async function runQueue(list: Row[]) {
    const ctl = new AbortController();
    abort.current = ctl;
    setRunning(true);
    // Local builds are instant; AI calls are kept to 2 at a time (free-tier limits).
    const workers = 2;
    let i = 0;
    let ok = 0;
    let bad = 0;
    const next = async (): Promise<void> => {
      while (!ctl.signal.aborted) {
        const row = list[i++];
        if (!row) return;
        const t0 = Date.now();
        update(row.key, { status: "running", error: undefined });
        try {
          const r = await makeOne(row.prompt, engine, { library, gemini, claude, signal: ctl.signal });
          update(row.key, {
            status: "done",
            via: r.via,
            assetId: r.asset.id,
            name: r.asset.name,
            hasThumb: r.asset.hasThumb,
            secs: Math.round((Date.now() - t0) / 1000),
          });
          ok++;
        } catch (e) {
          if (!ctl.signal.aborted) bad++;
          update(row.key, { status: ctl.signal.aborted ? "waiting" : "failed", error: e instanceof Error ? e.message : String(e) });
        }
      }
    };
    await Promise.all(Array.from({ length: workers }, next));
    setRunning(false);
    abort.current = null;
    refreshConfig();
    setMsg({ ok: bad === 0, text: ctl.signal.aborted ? "Dihentikan." : `Selesai: ${ok} berhasil${bad ? `, ${bad} gagal (klik ↻ untuk coba lagi)` : ""}.` });
  }

  function start() {
    if (!items.length) return setMsg({ ok: false, text: "Daftar barang masih kosong." });
    if (!available(engine)) return setMsg({ ok: false, text: "Engine itu belum aktif (API key belum diisi)." });
    if (engine === "tripo") {
      const need = items.length * TRIPO_COST.text;
      const bal = config?.balance;
      if (bal !== null && bal !== undefined && bal < need)
        return setMsg({ ok: false, text: `Saldo Tripo kurang: butuh ±${need} kredit, tersisa ${bal}.` });
      if (!window.confirm(`Proses ${items.length} barang dengan Tripo3D memakai ±${need} kredit. Lanjut?`)) return;
    }
    const list: Row[] = items.map((p, i) => ({ key: `${Date.now()}-${i}`, prompt: p, status: "waiting" }));
    setRows(list);
    setMsg(null);
    void runQueue(list);
  }

  function retryFailed() {
    const list = rows.filter((r) => r.status === "failed" || r.status === "waiting");
    if (!list.length) return;
    setRows((all) => all.map((r) => (list.includes(r) ? { ...r, status: "waiting", error: undefined } : r)));
    setMsg(null);
    void runQueue(list);
  }

  function retryOne(r: Row) {
    if (running) return;
    update(r.key, { status: "waiting", error: undefined });
    void runQueue([r]);
  }

  async function downloadAll() {
    const ready = rows.filter((r) => r.status === "done" && r.assetId);
    if (!ready.length) return;
    setZipping(true);
    try {
      const { zipSync } = await import("fflate");
      const files: Record<string, Uint8Array> = {};
      for (const [i, r] of ready.entries()) {
        const res = await fetch(`/api/assets/${r.assetId}/file`);
        if (!res.ok) continue;
        const ext = res.headers.get("content-type")?.includes("gltf") ? "glb" : "fbx";
        const safe = (r.name || r.prompt).replace(/[^\p{L}\p{N}\- ]+/gu, "").trim().replace(/\s+/g, "_") || `model_${i + 1}`;
        files[`${String(i + 1).padStart(2, "0")}_${safe}.${ext}`] = new Uint8Array(await res.arrayBuffer());
      }
      const zip = zipSync(files, { level: 0 });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([zip as BlobPart], { type: "application/zip" }));
      a.download = `kaytocraft_batch_${ready.length}_model.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    } catch (e) {
      setMsg({ ok: false, text: `Gagal membuat ZIP: ${e instanceof Error ? e.message : e}` });
    } finally {
      setZipping(false);
    }
  }

  const tripoCost = engine === "tripo" ? items.length * TRIPO_COST.text : 0;

  return (
    <div className="flex h-full gap-3 overflow-hidden">
      {/* ------------------------------------------------ input */}
      <section className="flex w-[380px] shrink-0 flex-col overflow-hidden rounded-[8px] bg-panel shadow-xl">
        <div className="border-b border-white/5 p-3">
          <h2 className="flex items-center gap-1.5 text-[16px] font-semibold tracking-[-0.16px]">
            <Layers size={15} className="text-accent" /> Batch Synthesis
          </h2>
          <p className="label-mono mt-1 text-dim">Banyak barang sekaligus — semua hasil masuk Asset Vault.</p>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
          <div
            role="button"
            tabIndex={0}
            onClick={() => fileInput.current?.click()}
            onKeyDown={(e) => e.key === "Enter" && fileInput.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              void pickFile(e.dataTransfer.files?.[0] ?? null);
            }}
            className="flex cursor-pointer flex-col items-center gap-1 rounded-[8px] border border-dashed border-line bg-field px-3 py-4 text-center hover:border-accent/50"
          >
            <FileSpreadsheet size={22} className="text-accent" />
            <p className="text-[13px] text-ink">Drop file .docx / .xlsx / .csv / .txt</p>
            <p className="label-mono text-dim">satu barang per baris / sel</p>
            <input
              ref={fileInput}
              type="file"
              accept=".docx,.xlsx,.csv,.txt,.doc,.xls"
              hidden
              onChange={(e) => {
                void pickFile(e.target.files?.[0] ?? null);
                e.target.value = "";
              }}
            />
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <label htmlFor="batch-list" className="label-mono uppercase text-dim">
                Daftar barang
              </label>
              <span className="label-mono text-accent">
                {items.length} barang{items.length >= MAX_ITEMS ? ` (maks ${MAX_ITEMS})` : ""}
              </span>
            </div>
            <textarea
              id="batch-list"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={"kursi\nmeja\nlampu\nlemari\nsofa merah\n…"}
              className="inp h-48 w-full resize-y font-mono text-[13px] leading-[20px]"
              disabled={running}
            />
          </div>

          <div>
            <p className="label-mono mb-1 uppercase text-dim">Dibuat dengan</p>
            <div className="flex flex-col gap-1">
              {ENGINES.map((e) => {
                const ok = available(e.id);
                return (
                  <label
                    key={e.id}
                    className={`flex cursor-pointer items-center gap-2 rounded-[6px] px-2 py-1.5 ${
                      engine === e.id ? "bg-raised ring-1 ring-accent/30" : "bg-field hover:bg-raised"
                    } ${ok ? "" : "opacity-40"}`}
                  >
                    <input
                      type="radio"
                      name="batch-engine"
                      checked={engine === e.id}
                      disabled={!ok || running}
                      onChange={() => setEngine(e.id)}
                      className="accent-[var(--color-accent)]"
                    />
                    <span className="flex-1">
                      <span className="block text-[13px] text-ink">{e.label}</span>
                      <span className="label-mono text-dim">{ok ? e.sub : "API key belum diisi"}</span>
                    </span>
                  </label>
                );
              })}
            </div>
            {engine === "auto" && (
              <p className="label-mono mt-1.5 text-dim">
                Barang yang ada di Library atau dikenal Mode Gratis dibuat instan. Sisanya dirancang Gemini{gemini ? "" : " (belum aktif)"}.
              </p>
            )}
            {engine === "tripo" && items.length > 0 && (
              <p className="label-mono mt-1.5 text-amber-300">
                Estimasi ±{tripoCost} kredit{config?.balance != null ? ` · saldo ${config.balance}` : ""}
              </p>
            )}
          </div>

          {msg && (
            <p className={`rounded-[6px] px-2 py-1.5 text-[12px] ${msg.ok ? "bg-accent/10 text-accent" : "bg-red-500/10 text-red-300"}`}>{msg.text}</p>
          )}
        </div>

        <div className="border-t border-white/5 p-3">
          {running ? (
            <button type="button" onClick={() => abort.current?.abort()} className="btn-secondary flex w-full items-center justify-center gap-2">
              <Square size={14} /> Hentikan
            </button>
          ) : (
            <button
              type="button"
              onClick={start}
              disabled={!items.length || !available(engine)}
              className="btn-primary flex w-full items-center justify-center gap-2 disabled:opacity-40"
            >
              <Play size={15} /> Proses {items.length || ""} barang
            </button>
          )}
          <p className="label-mono mt-1.5 text-center text-dim">Biarkan tab ini terbuka selama proses berjalan.</p>
        </div>
      </section>

      {/* ------------------------------------------------ results */}
      <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-[8px] bg-panel shadow-xl">
        <div className="flex flex-wrap items-center gap-3 border-b border-white/5 p-3">
          <h2 className="text-[16px] font-semibold tracking-[-0.16px]">Hasil</h2>
          {rows.length > 0 && (
            <span className="label-mono text-dim">
              <span className="text-accent">{done} selesai</span>
              {failed > 0 && <span className="text-red-300"> · {failed} gagal</span>}
              {pending > 0 && <span> · {pending} menunggu</span>}
              {" · "}
              {rows.length} total
            </span>
          )}
          {rows.length > 0 && (
            <div className="ml-auto h-1 w-40 overflow-hidden rounded-full bg-raised">
              <div
                className="h-full bg-gradient-to-r from-accent-deep to-violet transition-[width]"
                style={{ width: `${((done + failed) / rows.length) * 100}%` }}
              />
            </div>
          )}
          <div className={`flex gap-1.5 ${rows.length ? "" : "ml-auto"}`}>
            {!running && (failed > 0 || pending > 0) && (
              <button type="button" onClick={retryFailed} className="btn-secondary flex items-center gap-1.5 text-[12px]">
                <RotateCcw size={13} /> {failed > 0 ? "Coba lagi yang gagal" : "Lanjutkan"}
              </button>
            )}
            <button
              type="button"
              onClick={downloadAll}
              disabled={!done || zipping || running}
              className="btn-secondary flex items-center gap-1.5 text-[12px] disabled:opacity-40"
            >
              {zipping ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} Unduh semua (.zip)
            </button>
            {!running && rows.length > 0 && (
              <button type="button" onClick={() => setRows([])} title="Bersihkan daftar (model tetap di Asset Vault)" className="btn-secondary px-2">
                <Trash2 size={13} />
              </button>
            )}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {rows.length === 0 ? (
            <div className="grid h-full place-items-center text-center">
              <div>
                <Upload size={28} className="mx-auto mb-2 text-line" />
                <p className="text-[13px] text-dim">Masukkan file atau ketik daftar barang, lalu klik Proses.</p>
              </div>
            </div>
          ) : (
            <ul className="grid grid-cols-1 gap-1.5 lg:grid-cols-2 2xl:grid-cols-3">
              {rows.map((r, i) => (
                <li key={r.key} className="flex items-center gap-2 rounded-[8px] bg-field p-1.5">
                  <span className="label-mono w-6 shrink-0 text-right text-dim">{i + 1}</span>
                  <div className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-[4px] bg-page">
                    {r.status === "done" && r.hasThumb ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={`/api/assets/${r.assetId}/thumb`} alt="" className="size-full object-cover" />
                    ) : r.status === "running" ? (
                      <Loader2 size={16} className="animate-spin text-accent" />
                    ) : r.status === "failed" ? (
                      <AlertTriangle size={16} className="text-red-400" />
                    ) : r.status === "done" ? (
                      <CheckCircle2 size={16} className="text-accent" />
                    ) : (
                      <Clock size={16} className="text-line" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] text-ink">{r.name || r.prompt}</p>
                    <p
                      className={`label-mono truncate ${r.status === "failed" ? "text-red-300" : "text-dim"}`}
                      title={r.error}
                    >
                      {r.status === "waiting" && (r.error ? `Tertunda: ${r.error}` : "Menunggu")}
                      {r.status === "running" && "Memproses…"}
                      {r.status === "done" && `${VIA_LABEL[r.via ?? ""] ?? r.via} · ${r.secs ?? 0}s`}
                      {r.status === "failed" && (r.error ?? "Gagal")}
                    </p>
                  </div>
                  {r.status === "done" && r.assetId && (
                    <Link href={`/?asset=${r.assetId}`} title="Lihat di Generator" className="grid size-7 place-items-center rounded text-dim hover:bg-raised hover:text-accent">
                      <Eye size={14} />
                    </Link>
                  )}
                  {r.status === "failed" && !running && (
                    <button type="button" onClick={() => retryOne(r)} title="Coba lagi" className="grid size-7 place-items-center rounded text-dim hover:bg-raised hover:text-accent">
                      <RotateCcw size={14} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
