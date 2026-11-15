"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Box, CheckCircle2, Download, FileUp, Loader2, Package, Search, Square, SquareCheck } from "lucide-react";
import type { Asset } from "@/lib/types";
import { fetchPack, safeName, uploadFixedBlend } from "@/lib/packDownload";
import { DEFAULT_SELL, SWATCHES, makeCover, shapeItem, type SellOptions } from "@/lib/sellImages";
import { useConfig } from "@/lib/useConfig";

const OPT_KEY = "kc:jual:opts:v1";

type RowState = { msg: string; kind: "busy" | "ok" | "err" };

/**
 * "Siap Jual": choose models, image formats and model formats, then one ZIP with everything.
 * Renders come from the server (Blender with the studio template); formats are made here.
 */
export function JualStudio() {
  const config = useConfig();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [o, setO] = useState<SellOptions>(DEFAULT_SELL);
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const stop = useRef<AbortController | null>(null);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(OPT_KEY) ?? "null");
      if (saved) setO({ ...DEFAULT_SELL, ...saved, models: { ...DEFAULT_SELL.models, ...saved.models } });
    } catch {}
    fetch("/api/assets", { cache: "no-store" })
      .then((r) => r.json())
      .then((l: Asset[]) => setAssets(l.filter((a) => a.status === "ready")))
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(OPT_KEY, JSON.stringify(o));
    } catch {}
  }, [o]);
  useEffect(() => {
    if (!busy) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? assets.filter((a) => a.name.toLowerCase().includes(s)) : assets;
  }, [assets, q]);
  const chosen = assets.filter((a) => picked.has(a.id));
  const allShown = list.length > 0 && list.every((a) => picked.has(a.id));
  const imgCount = (o.png ? 1 : 0) + (o.jpgWhite ? 1 : 0) + (o.jpgColor ? 1 : 0) + (o.webp ? 1 : 0);
  const anyModel = Object.values(o.models).some(Boolean);
  const nothing = imgCount === 0 && !o.collage && !anyModel;
  const blendOk = config?.features?.blend ?? true;

  const setRow = (id: string, s: RowState | null) =>
    setRows((cur) => {
      const n = { ...cur };
      if (s) n[id] = s;
      else delete n[id];
      return n;
    });

  const toggle = (id: string) =>
    setPicked((cur) => {
      const n = new Set(cur);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

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
        setRow(a.id, { msg: "Menyiapkan…", kind: "busy" });
        try {
          const zip = await fetchPack(a.id, (m) => setRow(a.id, { msg: m, kind: "busy" }), ctl.signal);
          setRow(a.id, { msg: "Menyusun format…", kind: "busy" });
          const folder = `${String(i + 1).padStart(2, "0")}_${safeName(a.name, a.id)}`;
          firsts[i] = await shapeItem(unzipSync(zip), folder, o, files);
          done++;
          setRow(a.id, { msg: "Masuk paket ✓", kind: "ok" });
        } catch (e) {
          failed++;
          setRow(a.id, { msg: e instanceof Error ? e.message : String(e), kind: "err" });
        }
        setNote(`${done + failed}/${chosen.length} barang…`);
      }
    };
    try {
      // a few at a time: online each package is its own Blender job
      await Promise.all(Array.from({ length: Math.min(4, chosen.length) }, worker));
      if (ctl.signal.aborted) {
        setNote("Dihentikan. Paket yang sudah jadi tersimpan di server — klik lagi untuk lanjut cepat.");
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

  async function upload(a: Asset, f: File) {
    setRow(a.id, { msg: "Mengunggah 0%", kind: "busy" });
    try {
      const next = await uploadFixedBlend(a.id, f, (p) => setRow(a.id, { msg: `Mengunggah ${Math.round(p * 100)}%`, kind: "busy" }));
      setAssets((cur) => cur.map((x) => (x.id === next.id ? next : x)));
      setRow(a.id, { msg: ".blend perbaikan dipakai ✓", kind: "ok" });
    } catch (e) {
      setRow(a.id, { msg: e instanceof Error ? e.message : String(e), kind: "err" });
    }
  }

  const Check = (p: { on: boolean; set: (v: boolean) => void; label: string; hint?: string }) => (
    <label className="flex cursor-pointer items-start gap-2 rounded-[6px] bg-field px-2.5 py-2 hover:bg-raised">
      <input type="checkbox" checked={p.on} onChange={(e) => p.set(e.target.checked)} className="mt-0.5 accent-[var(--color-accent)]" />
      <span className="min-w-0">
        <span className="block text-[13px] text-ink">{p.label}</span>
        {p.hint && <span className="label-mono block text-dim">{p.hint}</span>}
      </span>
    </label>
  );

  return (
    <div className="flex flex-col gap-2 lg:h-full lg:flex-row lg:gap-3 lg:overflow-hidden">
      {/* ------------------------------------------------ options */}
      <section className="flex w-full shrink-0 flex-col overflow-hidden rounded-[8px] bg-panel shadow-xl lg:w-[340px] xl:w-[380px]">
        <div className="border-b border-white/5 p-3">
          <h2 className="flex items-center gap-1.5 text-[16px] font-semibold tracking-[-0.16px]">
            <Package size={15} className="text-accent" /> Siap Jual
          </h2>
          <p className="label-mono mt-1 text-dim">Render studio + semua format dalam satu ZIP, siap unggah ke marketplace.</p>
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

          <p className="label-mono rounded-[6px] bg-field p-2 text-dim">
            Render dibuat Blender di server dengan studio template-mu (pertama kali ±3–4 menit per barang, lalu tersimpan). Sudah memperbaiki
            model? Klik <span className="text-ink">Unggah .blend</span> di daftar — paket memakai file perbaikanmu.
          </p>
        </div>

        <div className="flex flex-col gap-1.5 border-t border-white/5 p-3">
          {busy ? (
            <button type="button" onClick={() => stop.current?.abort()} className="btn-secondary flex items-center justify-center gap-1.5">
              <Square size={13} /> Hentikan
            </button>
          ) : (
            <button
              type="button"
              onClick={build}
              disabled={!chosen.length || nothing || !blendOk}
              className="btn-primary flex items-center justify-center gap-1.5 disabled:opacity-40"
            >
              <Download size={14} /> Buat & unduh paket ({chosen.length})
            </button>
          )}
          <p className="label-mono min-h-[14px] text-center text-dim" aria-live="polite">
            {note ?? (nothing ? "Pilih minimal satu format." : !blendOk ? "Blender belum tersedia di server ini." : "Biarkan tab ini terbuka selama proses.")}
          </p>
        </div>
      </section>

      {/* ------------------------------------------------ models */}
      <section className="flex min-h-[50vh] min-w-0 flex-1 flex-col overflow-hidden rounded-[8px] bg-panel shadow-xl lg:min-h-0">
        <div className="flex flex-wrap items-center gap-2 border-b border-white/5 p-3">
          <h3 className="text-[15px] font-semibold">Model</h3>
          <span className="label-mono text-accent">{chosen.length} dipilih</span>
          <div className="relative ml-auto w-full sm:w-56">
            <Search size={13} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-dim" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari model…" className="w-full rounded-[4px] bg-field py-1.5 pl-7 pr-2 text-[13px] outline-none focus:ring-1 focus:ring-accent/40" />
          </div>
          <button
            type="button"
            onClick={() =>
              setPicked((cur) => {
                const n = new Set(cur);
                for (const a of list) {
                  if (allShown) n.delete(a.id);
                  else n.add(a.id);
                }
                return n;
              })
            }
            className="btn-secondary text-[12px]"
          >
            {allShown ? "Batal pilih semua" : "Pilih semua"}
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {!loaded ? (
            <p className="flex items-center justify-center gap-2 p-8 text-[13px] text-dim">
              <Loader2 size={15} className="animate-spin" /> Memuat model…
            </p>
          ) : !list.length ? (
            <p className="p-8 text-center text-[13px] text-dim">{assets.length ? "Tidak ada yang cocok." : "Belum ada model. Buat dulu di Text to 3D atau Batch."}</p>
          ) : (
            <ul className="grid grid-cols-1 gap-1.5 md:grid-cols-2 2xl:grid-cols-3">
              {list.map((a) => (
                <Item key={a.id} a={a} on={picked.has(a.id)} row={rows[a.id]} toggle={() => toggle(a.id)} upload={(f) => upload(a, f)} disabled={busy} />
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}

function Item(p: { a: Asset; on: boolean; row?: RowState; toggle: () => void; upload: (f: File) => void; disabled: boolean }) {
  const { a, row } = p;
  const file = useRef<HTMLInputElement>(null);
  return (
    <li
      className={`flex items-center gap-2 rounded-[8px] p-1.5 transition-colors ${p.on ? "bg-raised ring-1 ring-accent/30" : "bg-field hover:bg-raised"}`}
    >
      <button type="button" onClick={p.toggle} disabled={p.disabled} aria-pressed={p.on} aria-label={`Pilih ${a.name}`} className="flex min-w-0 flex-1 items-center gap-2 text-left">
        {p.on ? <SquareCheck size={16} className="shrink-0 text-accent" /> : <Square size={16} className="shrink-0 text-dim" />}
        <span className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-[4px] bg-page">
          {a.hasThumb ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/assets/${a.id}/thumb?v=${a.completedAt ?? 0}`} alt="" className="size-full object-cover" />
          ) : (
            <Box size={16} className="text-line" />
          )}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[13px] text-ink">
            {a.name} {a.blendFixedAt ? <span className="label-mono text-accent" title="Pakai .blend hasil perbaikanmu">✓ fix</span> : null}
          </span>
          <span
            className={`label-mono flex items-center gap-1 truncate ${row?.kind === "err" ? "text-red-300" : row?.kind === "ok" ? "text-accent" : "text-dim"}`}
            title={row?.msg}
          >
            {row?.kind === "busy" && <Loader2 size={10} className="shrink-0 animate-spin" />}
            {row?.kind === "ok" && <CheckCircle2 size={10} className="shrink-0" />}
            {row?.kind === "err" && <AlertTriangle size={10} className="shrink-0" />}
            {row?.msg ?? (a.stats ? `${a.stats.triangles.toLocaleString()} tris` : "siap")}
          </span>
        </span>
      </button>
      <button
        type="button"
        onClick={() => file.current?.click()}
        disabled={p.disabled}
        title="Unggah .blend yang sudah kamu perbaiki"
        className="label-mono flex shrink-0 items-center gap-0.5 rounded-[4px] bg-page px-1.5 py-1 text-dim hover:text-accent disabled:opacity-40"
      >
        <FileUp size={11} /> .blend
      </button>
      <input
        ref={file}
        type="file"
        accept=".blend"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) p.upload(f);
        }}
      />
    </li>
  );
}
