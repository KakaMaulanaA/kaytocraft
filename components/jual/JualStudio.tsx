"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, FileBox, FileUp, Loader2, Package, RefreshCw, Square, SquareCheck, Trash2, UploadCloud } from "lucide-react";
import { appendFile } from "@/lib/upload";
import { fetchPackAt, safeName } from "@/lib/packDownload";
import { DEFAULT_SELL, SWATCHES, makeCover, shapeItem, type SellOptions } from "@/lib/sellImages";
import { useConfig } from "@/lib/useConfig";

const OPT_KEY = "kc:jual:opts:v1";

interface Item {
  id: string;
  name: string;
  size: number;
  createdAt: number;
  state: "new" | "rendering" | "ready" | "error";
}
type Status = { msg: string; kind: "busy" | "ok" | "err" };

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;

/**
 * Siap Jual — the last step:
 *   Batch -> download .blend (studio template) -> fix in Blender -> upload here -> renders + formats -> ZIP.
 * Only the .blend files the user uploaded are listed; each one is rendered as soon as it arrives.
 */
export function JualStudio() {
  const config = useConfig();
  const [items, setItems] = useState<Item[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<Record<string, Status>>({});
  const [uploads, setUploads] = useState<{ name: string; msg: string; err?: boolean }[]>([]);
  const [o, setO] = useState<SellOptions>(DEFAULT_SELL);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const watching = useRef(new Set<string>());
  const stop = useRef<AbortController | null>(null);
  const blendOk = config?.features?.blend ?? true;

  const setStat = useCallback(
    (id: string, s: Status) => setStatus((cur) => ({ ...cur, [id]: s })),
    [],
  );

  /** Start (if needed) and follow the render of one item until its package is ready. */
  const watch = useCallback(
    async (id: string, since = Date.now()) => {
      if (watching.current.has(id)) return;
      watching.current.add(id);
      const started = since; // upload time, so the counter survives a page reload
      try {
        for (;;) {
          const r = await fetch(`/api/sell/${id}/pack`, { cache: "no-store" }).catch(() => null);
          if (!r) {
            await new Promise((s) => setTimeout(s, 8000));
            continue;
          }
          const b = await r.json().catch(() => null);
          if (r.status === 202) {
            const m = Math.floor((Date.now() - started) / 60_000);
            setStat(id, { msg: `Render… ${m ? `${m} mnt` : ""}`.trim(), kind: "busy" });
            await new Promise((s) => setTimeout(s, 8000));
            continue;
          }
          if (r.ok) {
            setStat(id, { msg: "Render siap ✓", kind: "ok" });
            setItems((cur) => cur.map((x) => (x.id === id ? { ...x, state: "ready" } : x)));
          } else {
            setStat(id, { msg: b?.error ?? `Gagal (${r.status})`, kind: "err" });
            setItems((cur) => cur.map((x) => (x.id === id ? { ...x, state: "error" } : x)));
          }
          return;
        }
      } finally {
        watching.current.delete(id);
      }
    },
    [setStat],
  );

  const load = useCallback(async () => {
    try {
      const list: Item[] = await (await fetch("/api/sell", { cache: "no-store" })).json();
      setItems(list);
      for (const it of list) {
        if (it.state === "ready") setStat(it.id, { msg: "Render siap ✓", kind: "ok" });
        else void watch(it.id, it.state === "error" ? Date.now() : it.createdAt); // new / rendering / error (retry) -> render now
      }
    } catch {
    } finally {
      setLoaded(true);
    }
  }, [setStat, watch]);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(OPT_KEY) ?? "null");
      if (saved) setO({ ...DEFAULT_SELL, ...saved, models: { ...DEFAULT_SELL.models, ...saved.models } });
    } catch {}
    void load();
  }, [load]);
  useEffect(() => {
    try {
      localStorage.setItem(OPT_KEY, JSON.stringify(o));
    } catch {}
  }, [o]);
  const working = busy || uploads.some((u) => !u.err && !u.msg.startsWith("✓"));
  useEffect(() => {
    if (!working) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [working]);

  /** Upload fixed .blend files (several at once); each one starts rendering right away. */
  async function addFiles(list: FileList | File[] | null, replace?: Item) {
    const files = Array.from(list ?? []).filter((f) => /\.blend\d*$/i.test(f.name));
    if (!files.length) {
      setNote("Pilih file .blend.");
      return;
    }
    setNote(null);
    for (const f of files) {
      const row = { name: f.name, msg: "0%" };
      setUploads((cur) => [...cur.filter((u) => u.name !== f.name), row]);
      const upd = (msg: string, err?: boolean) => setUploads((cur) => cur.map((u) => (u.name === f.name ? { ...u, msg, err } : u)));
      try {
        const fd = new FormData();
        await appendFile(fd, "file", f, f.name, (p) => upd(`${Math.round(p * 100)}%`));
        if (replace) fd.append("replace", replace.id);
        const r = await fetch("/api/sell", { method: "POST", body: fd });
        const body = await r.json().catch(() => null);
        if (!r.ok) throw new Error(body?.error ?? `Upload gagal (${r.status})`);
        const it: Item = { ...body, state: "new" };
        setItems((cur) => [it, ...cur.filter((x) => x.id !== it.id)]);
        setPicked((cur) => new Set(cur).add(it.id));
        upd("✓ diunggah");
        void watch(it.id);
      } catch (e) {
        upd(e instanceof Error ? e.message : String(e), true);
      }
    }
    setTimeout(() => setUploads((cur) => cur.filter((u) => u.err)), 4000);
  }

  async function remove(it: Item) {
    if (!confirm(`Hapus "${it.name}" dari Siap Jual? (file .blend & render-nya di server)`)) return;
    const r = await fetch(`/api/sell/${it.id}`, { method: "DELETE" });
    if (r.ok) {
      setItems((cur) => cur.filter((x) => x.id !== it.id));
      setPicked((cur) => {
        const n = new Set(cur);
        n.delete(it.id);
        return n;
      });
    }
  }

  const chosen = items.filter((a) => picked.has(a.id));
  const imgCount = (o.png ? 1 : 0) + (o.jpgWhite ? 1 : 0) + (o.jpgColor ? 1 : 0) + (o.webp ? 1 : 0);
  const anyModel = Object.values(o.models).some(Boolean);
  const nothing = imgCount === 0 && !o.collage && !anyModel;
  const allPicked = items.length > 0 && items.every((a) => picked.has(a.id));
  const readyCount = items.filter((a) => a.state === "ready").length;

  async function build() {
    if (!chosen.length || busy || nothing) return;
    setBusy(true);
    setNote(null);
    const ctl = new AbortController();
    stop.current = ctl;
    const { zipSync, unzipSync } = await import("fflate");
    const files: Record<string, Uint8Array> = {};
    const firsts: (ImageBitmap | null)[] = new Array(chosen.length).fill(null);
    let done = 0;
    let failed = 0;
    const queue = chosen.map((a, i) => [a, i] as const);
    const worker = async () => {
      for (let job = queue.shift(); job; job = queue.shift()) {
        const [a, i] = job;
        if (ctl.signal.aborted) return;
        try {
          const zip = await fetchPackAt(`/api/sell/${a.id}/pack`, (m) => setStat(a.id, { msg: m, kind: "busy" }), ctl.signal);
          setStat(a.id, { msg: "Menyusun format…", kind: "busy" });
          const folder = `${String(i + 1).padStart(2, "0")}_${safeName(a.name, a.id)}`;
          firsts[i] = await shapeItem(unzipSync(zip), folder, o, files);
          done++;
          setStat(a.id, { msg: "Masuk paket ✓", kind: "ok" });
        } catch (e) {
          failed++;
          setStat(a.id, { msg: e instanceof Error ? e.message : String(e), kind: "err" });
        }
        setNote(`${done + failed}/${chosen.length} barang…`);
      }
    };
    try {
      await Promise.all(Array.from({ length: Math.min(4, chosen.length) }, worker));
      if (ctl.signal.aborted) {
        setNote("Dihentikan.");
        return;
      }
      if (!done) {
        setNote("Tidak ada paket yang berhasil.");
        return;
      }
      if (o.cover) {
        const cover = await makeCover(firsts.filter((b): b is ImageBitmap => !!b), o.jpgColor ? o.color : "#ffffff");
        if (cover) files["00_SAMPUL_PAKET.jpg"] = cover;
      }
      firsts.forEach((b) => b?.close());
      const zip = zipSync(files, { level: 0 });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([zip as BlobPart], { type: "application/zip" }));
      a.download = chosen.length === 1 ? `${safeName(chosen[0].name)}_siap_jual.zip` : `kaytocraft_siap_jual_${done}_barang.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      setNote(`Selesai: ${done} barang${failed ? `, ${failed} gagal (lihat daftar)` : ""}.`);
    } catch (e) {
      setNote(`Gagal membuat ZIP: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(false);
      stop.current = null;
    }
  }

  return (
    <div className="flex flex-col gap-2 lg:h-full lg:flex-row lg:gap-3 lg:overflow-hidden">
      {/* ------------------------------------------------ uploaded fixes */}
      <section className="flex min-h-[50vh] min-w-0 flex-1 flex-col overflow-hidden rounded-[8px] bg-panel shadow-xl lg:order-2 lg:min-h-0">
        <div className="border-b border-white/5 p-3">
          <h2 className="flex items-center gap-1.5 text-[16px] font-semibold tracking-[-0.16px]">
            <Package size={15} className="text-accent" /> Siap Jual
          </h2>
          <p className="label-mono mt-1 text-dim">
            Batch → unduh .blend → perbaiki di Blender → <span className="text-ink">unggah di sini</span> → render & semua format → ZIP siap jual.
          </p>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
          <div
            role="button"
            tabIndex={0}
            onClick={() => fileInput.current?.click()}
            onKeyDown={(e) => e.key === "Enter" && fileInput.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              void addFiles(e.dataTransfer.files);
            }}
            className={`flex cursor-pointer flex-col items-center gap-1 rounded-[8px] border border-dashed px-3 py-6 text-center transition-colors ${
              drag ? "border-accent bg-accent/5" : "border-line bg-field hover:border-accent/50"
            }`}
          >
            <UploadCloud size={26} className="text-accent" />
            <p className="text-[14px] text-ink">Drop file .blend hasil perbaikanmu</p>
            <p className="label-mono text-dim">boleh banyak sekaligus · tiap file langsung dirender (±3–4 menit)</p>
            <input ref={fileInput} type="file" accept=".blend" multiple hidden onChange={(e) => (void addFiles(e.target.files), (e.target.value = ""))} />
          </div>

          {uploads.length > 0 && (
            <ul className="flex flex-col gap-1">
              {uploads.map((u) => (
                <li key={u.name} className={`label-mono flex items-center gap-1.5 rounded-[4px] bg-field px-2 py-1 ${u.err ? "text-red-300" : "text-dim"}`}>
                  {u.err ? <AlertTriangle size={11} /> : u.msg.startsWith("✓") ? <CheckCircle2 size={11} className="text-accent" /> : <Loader2 size={11} className="animate-spin" />}
                  <span className="truncate text-ink">{u.name}</span>
                  <span className="ml-auto shrink-0">{u.msg}</span>
                </li>
              ))}
            </ul>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[14px] font-semibold">File perbaikan</h3>
            <span className="label-mono text-dim">
              {items.length} file · {readyCount} siap · <span className="text-accent">{chosen.length} dipilih</span>
            </span>
            {items.length > 0 && (
              <button
                type="button"
                onClick={() => setPicked(allPicked ? new Set() : new Set(items.map((a) => a.id)))}
                className="btn-secondary ml-auto text-[12px]"
              >
                {allPicked ? "Batal pilih semua" : "Pilih semua"}
              </button>
            )}
          </div>

          {!loaded ? (
            <p className="flex items-center justify-center gap-2 p-6 text-[13px] text-dim">
              <Loader2 size={15} className="animate-spin" /> Memuat…
            </p>
          ) : !items.length ? (
            <div className="rounded-[8px] bg-field p-4 text-[13px] leading-relaxed text-dim">
              Belum ada file. Alurnya:
              <ol className="mt-1.5 list-decimal pl-5 text-ink">
                <li>Buat model di <b>Batch Synthesis</b> (dari ide/tema kamu).</li>
                <li>Klik <b>Unduh semua .blend</b> — sudah masuk studio template (kamera, lighting, warna palet).</li>
                <li>Perbaiki di Blender, simpan.</li>
                <li>Drop file .blend-nya di atas → dirender otomatis.</li>
                <li>Pilih format di samping → <b>Buat & unduh paket</b>.</li>
              </ol>
            </div>
          ) : (
            <ul className="grid grid-cols-1 gap-1.5 md:grid-cols-2 2xl:grid-cols-3">
              {items.map((it) => (
                <Row
                  key={it.id}
                  it={it}
                  on={picked.has(it.id)}
                  st={status[it.id]}
                  disabled={busy}
                  toggle={() =>
                    setPicked((cur) => {
                      const n = new Set(cur);
                      if (n.has(it.id)) n.delete(it.id);
                      else n.add(it.id);
                      return n;
                    })
                  }
                  replace={(f) => addFiles([f], it)}
                  remove={() => remove(it)}
                  retry={() => void watch(it.id)}
                />
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* ------------------------------------------------ formats + download */}
      <section className="flex w-full shrink-0 flex-col overflow-hidden rounded-[8px] bg-panel shadow-xl lg:order-1 lg:w-[340px] xl:w-[380px]">
        <div className="border-b border-white/5 p-3">
          <h2 className="text-[15px] font-semibold">Format paket</h2>
          <p className="label-mono mt-1 text-dim">Ganti format tidak perlu render ulang.</p>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
          <div>
            <p className="label-mono mb-1.5 uppercase text-dim">Gambar (tiap sudut kamera)</p>
            <div className="flex flex-col gap-1">
              <Check on={o.png} set={(v) => setO({ ...o, png: v })} label="PNG transparan" hint="untuk mockup / ditempel di desain lain" />
              <Check on={o.jpgWhite} set={(v) => setO({ ...o, jpgWhite: v })} label="JPG latar putih" hint="foto utama marketplace" />
              <Check on={o.jpgColor} set={(v) => setO({ ...o, jpgColor: v })} label="JPG latar warna" hint="warna dari palet template-mu" />
              {o.jpgColor && (
                <div className="flex flex-wrap items-center gap-1.5 px-2.5 pb-1">
                  {SWATCHES.map((s) => (
                    <button
                      key={s.hex}
                      type="button"
                      title={s.name}
                      aria-label={s.name}
                      onClick={() => setO({ ...o, color: s.hex })}
                      className={`size-6 rounded-full ring-offset-2 ring-offset-panel ${o.color.toLowerCase() === s.hex.toLowerCase() ? "ring-2 ring-accent" : "ring-1 ring-white/20"}`}
                      style={{ background: s.hex }}
                    />
                  ))}
                  <input type="color" value={o.color} onChange={(e) => setO({ ...o, color: e.target.value })} title="Warna lain" className="size-6 cursor-pointer rounded bg-transparent" />
                </div>
              )}
              <Check on={o.webp} set={(v) => setO({ ...o, webp: v })} label="WebP" hint="file kecil untuk toko online / web sendiri" />
              <Check on={o.collage} set={(v) => setO({ ...o, collage: v })} label="Kolase per barang" hint="semua sudut + clay dalam satu JPG" />
              <Check on={o.clay} set={(v) => setO({ ...o, clay: v })} label="Sertakan render clay" hint="abu-abu polos, memperlihatkan bentuk" />
              <Check on={o.cover} set={(v) => setO({ ...o, cover: v })} label="Sampul paket" hint="satu gambar berisi semua barang terpilih" />
            </div>
          </div>
          <div>
            <p className="label-mono mb-1.5 uppercase text-dim">Format model</p>
            <div className="grid grid-cols-2 gap-1">
              {(["blend", "glb", "fbx", "obj"] as const).map((k) => (
                <Check key={k} on={o.models[k]} set={(v) => setO({ ...o, models: { ...o.models, [k]: v } })} label={`.${k}`} />
              ))}
            </div>
            <p className="label-mono mt-1.5 text-dim">Ukuran model = ukuran asli (meter). INFO.txt (tris, ukuran, material) selalu ikut.</p>
          </div>
        </div>
        <div className="flex flex-col gap-1.5 border-t border-white/5 p-3">
          {busy ? (
            <button type="button" onClick={() => stop.current?.abort()} className="btn-secondary flex items-center justify-center gap-1.5">
              <Square size={13} /> Hentikan
            </button>
          ) : (
            <button type="button" onClick={build} disabled={!chosen.length || nothing || !blendOk} className="btn-primary flex items-center justify-center gap-1.5 disabled:opacity-40">
              <Download size={14} /> Buat & unduh paket ({chosen.length})
            </button>
          )}
          <p className="label-mono min-h-[14px] text-center text-dim" aria-live="polite">
            {note ??
              (nothing
                ? "Pilih minimal satu format."
                : !blendOk
                  ? "Blender belum tersedia di server ini."
                  : chosen.some((c) => c.state !== "ready")
                    ? "Yang belum selesai dirender akan ditunggu."
                    : "Biarkan tab ini terbuka selama proses.")}
          </p>
        </div>
      </section>
    </div>
  );
}

/** One option row (top-level so it keeps its DOM node — and keyboard focus — between renders). */
function Check(p: { on: boolean; set: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-2 rounded-[6px] bg-field px-2.5 py-2 hover:bg-raised focus-within:ring-1 focus-within:ring-accent/50">
      <input type="checkbox" checked={p.on} onChange={(e) => p.set(e.target.checked)} className="mt-0.5 accent-[var(--color-accent)]" />
      <span className="min-w-0">
        <span className="block text-[13px] text-ink">{p.label}</span>
        {p.hint && <span className="label-mono block text-dim">{p.hint}</span>}
      </span>
    </label>
  );
}

function Row(p: {
  it: Item;
  on: boolean;
  st?: Status;
  disabled: boolean;
  toggle: () => void;
  replace: (f: File) => void;
  remove: () => void;
  retry: () => void;
}) {
  const { it, st } = p;
  const file = useRef<HTMLInputElement>(null);
  const kind = st?.kind ?? (it.state === "ready" ? "ok" : it.state === "error" ? "err" : "busy");
  const msg = st?.msg ?? (it.state === "ready" ? "Render siap ✓" : it.state === "error" ? "Render gagal" : "Menunggu render…");
  return (
    <li className={`flex items-center gap-2 rounded-[8px] p-1.5 transition-colors ${p.on ? "bg-raised ring-1 ring-accent/30" : "bg-field hover:bg-raised"}`}>
      <button type="button" onClick={p.toggle} disabled={p.disabled} aria-pressed={p.on} aria-label={`Pilih ${it.name}`} className="flex min-w-0 flex-1 items-center gap-2 text-left">
        {p.on ? <SquareCheck size={16} className="shrink-0 text-accent" /> : <Square size={16} className="shrink-0 text-dim" />}
        <span className="grid size-10 shrink-0 place-items-center rounded-[4px] bg-page">
          <FileBox size={16} className={kind === "ok" ? "text-accent" : "text-line"} />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[13px] text-ink">{it.name}</span>
          <span className={`label-mono flex items-center gap-1 truncate ${kind === "err" ? "text-red-300" : kind === "ok" ? "text-accent" : "text-dim"}`} title={msg}>
            {kind === "busy" && <Loader2 size={10} className="shrink-0 animate-spin" />}
            {kind === "ok" && <CheckCircle2 size={10} className="shrink-0" />}
            {kind === "err" && <AlertTriangle size={10} className="shrink-0" />}
            {msg} <span className="text-dim">· {mb(it.size)}</span>
          </span>
        </span>
      </button>
      {kind === "err" && (
        <button type="button" onClick={p.retry} title="Render ulang" aria-label="Render ulang" className="grid size-7 shrink-0 place-items-center rounded text-dim hover:bg-page hover:text-accent">
          <RefreshCw size={13} />
        </button>
      )}
      <button
        type="button"
        onClick={() => file.current?.click()}
        disabled={p.disabled}
        title="Ganti dengan .blend versi terbaru (dirender ulang)"
        aria-label="Ganti file"
        className="grid size-7 shrink-0 place-items-center rounded text-dim hover:bg-page hover:text-accent disabled:opacity-40"
      >
        <FileUp size={13} />
      </button>
      <button type="button" onClick={p.remove} disabled={p.disabled} title="Hapus" aria-label="Hapus" className="grid size-7 shrink-0 place-items-center rounded text-dim hover:bg-page hover:text-red-400 disabled:opacity-40">
        <Trash2 size={13} />
      </button>
      <input
        ref={file}
        type="file"
        accept=".blend"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) p.replace(f);
        }}
      />
    </li>
  );
}
