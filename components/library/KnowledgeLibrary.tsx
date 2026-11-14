"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  BookOpen,
  Box,
  FileUp,
  Image as ImageIcon,
  Languages,
  Loader2,
  Save,
  Sparkles,
  Trash2,
  Type,
  Wand2,
  X,
} from "lucide-react";
import type { ModelViewer } from "@/lib/three/viewer";
import type { ModelSpec } from "@/lib/modelSpec";
import type { LibraryEntry } from "@/lib/library";
import { groupToGlb, refreshLibrary, useLibrary } from "@/lib/useLibrary";
import { useConfig } from "@/lib/useConfig";
import { appendFile } from "@/lib/upload";
import { requestDesign } from "@/lib/designClient";

type Tab = "text" | "file" | "image" | "dict";

/** What is waiting in the preview, ready to be saved. */
type Pending =
  | { kind: "spec"; spec: ModelSpec; url: string; origin: string }
  | { kind: "file"; file: File; url?: string; format: "glb" | "fbx" | "blend" };

export function KnowledgeLibrary() {
  const lib = useLibrary();
  const config = useConfig();
  const aiEngines = (config?.engines ?? []).filter((e) => (e.id === "gemini" || e.id === "claude") && e.available);
  const [aiEngine, setAiEngine] = useState<"gemini" | "claude">("gemini");
  const ai = aiEngines.find((e) => e.id === aiEngine) ?? aiEngines[0];
  const claudeOn = !!ai;
  const aiName = ai?.id === "claude" ? "Claude" : "Gemini";

  const [tab, setTab] = useState<Tab>("text");
  const [label, setLabel] = useState("");
  const [keywords, setKeywords] = useState("");
  const [desc, setDesc] = useState("");
  const [recipe, setRecipe] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [filter, setFilter] = useState("");

  const host = useRef<HTMLDivElement>(null);
  const viewer = useRef<ModelViewer | null>(null);

  useEffect(() => {
    let off = false;
    import("@/lib/three/viewer").then(({ ModelViewer }) => {
      if (!off && host.current) viewer.current = new ModelViewer(host.current);
    });
    return () => {
      off = true;
      viewer.current?.dispose();
      viewer.current = null;
    };
  }, []);

  const say = (ok: boolean, text: string) => setMsg({ ok, text });

  async function previewSpec(spec: ModelSpec, origin: string) {
    const { buildFromSpec } = await import("@/lib/procedural/fromSpec");
    const blob = await groupToGlb(buildFromSpec(spec));
    const url = URL.createObjectURL(blob);
    await viewer.current?.load(url, "glb");
    setPending({ kind: "spec", spec, url, origin });
    if (!label && spec.name) setLabel(spec.name);
  }

  async function designWithClaude(prompt: string, img?: File) {
    setBusy(`${aiName} sedang merancang…`);
    setMsg(null);
    try {
      let image: { mediaType: string; data: string } | undefined;
      if (img) {
        const buf = new Uint8Array(await img.arrayBuffer());
        let bin = "";
        for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
        image = { mediaType: img.type, data: btoa(bin) };
      }
      const body = await requestDesign({ engine: ai?.id ?? "gemini", prompt, image }, aiName);
      await previewSpec(body.spec, img ? "image" : "text");
      say(true, `Rancangan ${aiName} siap (${body.spec.parts.length} part). Cek di preview, lalu Simpan.`);
    } catch (e) {
      say(false, e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function previewRecipe() {
    setMsg(null);
    try {
      const { sanitizeSpec } = await import("@/lib/modelSpec");
      const spec = sanitizeSpec(JSON.parse(recipe));
      if (!spec.parts.length) throw new Error("Resep tidak berisi part yang valid.");
      await previewSpec(spec, "chat");
      say(true, `Resep valid (${spec.parts.length} part).`);
    } catch (e) {
      say(false, `Resep tidak valid: ${e instanceof Error ? e.message : e}`);
    }
  }

  async function pickFile(f: File | null) {
    setMsg(null);
    if (!f) return;
    const n = f.name.toLowerCase();
    const format = n.endsWith(".glb") ? "glb" : n.endsWith(".fbx") ? "fbx" : n.endsWith(".blend") ? "blend" : null;
    if (!format) return say(false, "Format harus .glb, .fbx, atau .blend");
    if (!label) setLabel(f.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " "));
    if (format === "blend" && config?.features && !config.features.blend)
      return say(false, "Versi online belum bisa membaca .blend (butuh Blender). Di Blender: File › Export › glTF 2.0 (.glb), lalu unggah .glb-nya.");
    if (format === "blend") {
      viewer.current?.clear();
      setPending({ kind: "file", file: f, format });
      return say(true, "File .blend akan dikonversi dengan Blender saat disimpan.");
    }
    const url = URL.createObjectURL(f);
    try {
      await viewer.current?.load(url, format);
      setPending({ kind: "file", file: f, url, format });
    } catch {
      say(false, "File tidak bisa dibaca.");
    }
  }

  async function save() {
    if (!pending) return;
    if (!keywords.trim() && !label.trim()) return say(false, "Isi nama dan kata kunci dulu.");
    setBusy("Menyimpan…");
    try {
      const fd = new FormData();
      fd.append("label", label);
      fd.append("keywords", keywords || label);
      fd.append("description", desc);
      if (pending.kind === "spec") {
        fd.append("spec", JSON.stringify(pending.spec));
        fd.append("origin", pending.origin);
      } else {
        await appendFile(fd, "file", pending.file, pending.file.name);
        fd.append("origin", "file");
      }
      if (viewer.current?.hasModel) {
        const thumb = await viewer.current.snapshot();
        if (thumb) fd.append("thumb", thumb, "thumb.png");
      }
      const res = await fetch("/api/library", { method: "POST", body: fd });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || "Gagal menyimpan");
      say(true, `Tersimpan: "${body.label}". Ketik "${body.keywords[0]}" di Generator untuk memakainya gratis.`);
      setPending(null);
      setLabel("");
      setKeywords("");
      setDesc("");
      setRecipe("");
      setImage(null);
      viewer.current?.clear();
      refreshLibrary();
    } catch (e) {
      say(false, e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const entries = lib.entries.filter(
    (e) => !filter.trim() || [e.label, ...e.keywords].some((k) => k.toLowerCase().includes(filter.toLowerCase())),
  );

  return (
    <div className="flex flex-col gap-2 lg:h-full lg:flex-row">
      {/* Add knowledge */}
      <section className="flex w-full shrink-0 flex-col overflow-hidden rounded-[8px] bg-panel lg:h-full lg:w-[340px] xl:w-[380px]">
        <div className="bg-strip p-3">
          <h1 className="flex items-center gap-1.5 text-[16px] font-semibold">
            <BookOpen size={15} className="text-accent" /> Tambah Knowledge
          </h1>
          <p className="label-mono mt-1 text-dim">Yang kamu ajarkan di sini dipakai gratis saat prompt cocok.</p>
          <div className="mt-2 grid grid-cols-4 gap-1 rounded-[4px] bg-field p-0.5">
            {(
              [
                ["text", "Tulisan", Type],
                ["file", "File", FileUp],
                ["image", "Gambar", ImageIcon],
                ["dict", "Kamus", Languages],
              ] as const
            ).map(([id, name, Icon]) => (
              <button
                key={id}
                onClick={() => {
                  setTab(id);
                  setMsg(null);
                }}
                className={`flex items-center justify-center gap-1 rounded-[2px] py-1 text-[11px] ${
                  tab === id ? "bg-raised text-ink" : "text-dim hover:text-ink"
                }`}
              >
                <Icon size={12} /> {name}
              </button>
            ))}
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
          {tab !== "dict" && (
            <>
              <Field label="Nama barang">
                <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Sofa Kulit 3 Dudukan" className="inp" />
              </Field>
              <Field label="Kata kunci (pisahkan koma)" hint="kata yang akan kamu ketik di Generator">
                <input value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="sofa, sofa kulit, couch" className="inp" />
              </Field>
            </>
          )}

          {tab === "text" && (
            <>
              <Field label="Deskripsi barang">
                <textarea
                  value={desc}
                  onChange={(e) => setDesc(e.target.value)}
                  rows={4}
                  placeholder="Sofa 3 dudukan, rangka kayu jati, bantalan kulit coklat, kaki besi hitam pendek, sandaran agak miring."
                  className="inp resize-none"
                />
              </Field>
              <AiPicker engines={aiEngines.map((e) => e.id as "gemini" | "claude")} value={ai?.id as "gemini" | "claude" | undefined} onChange={setAiEngine} />
              <button
                disabled={!claudeOn || !!busy || !(desc.trim() || label.trim())}
                onClick={() => designWithClaude(desc.trim() || label)}
                className="btn-primary"
              >
                <Sparkles size={14} /> Rancang dengan {aiName}
              </button>
              {!claudeOn && (
                <p className="label-mono text-amber-300">
                  Isi GEMINI_API_KEY (gratis, aistudio.google.com/apikey) di .env.local lalu restart server. Atau tempel resep di bawah.
                </p>
              )}
              <details className="rounded-[4px] border border-line/60 p-2">
                <summary className="cursor-pointer text-[12px] text-dim">Tempel resep JSON (gratis)</summary>
                <textarea
                  value={recipe}
                  onChange={(e) => setRecipe(e.target.value)}
                  rows={6}
                  placeholder='{"name":"Sofa","parts":[{"name":"Seat","shape":"box","size":[1.8,0.2,0.8],"position":[0,0.4,0],"material":"leather"}]}'
                  className="inp mt-2 resize-y font-mono text-[11px]"
                />
                <button disabled={!recipe.trim()} onClick={previewRecipe} className="btn-secondary mt-2">
                  <Wand2 size={13} /> Preview resep
                </button>
              </details>
            </>
          )}

          {tab === "file" && (
            <DropBox accept=".glb,.fbx,.blend" onFile={pickFile} label="Drop file .glb / .fbx / .blend" sub="Model dari Blender, Tripo/Meshy web, Sketchfab, Poly Haven (CC0)…" file={pending?.kind === "file" ? pending.file : null} />
          )}

          {tab === "image" && (
            <>
              <DropBox
                accept="image/png,image/jpeg,image/webp"
                onFile={(f) => setImage(f)}
                label="Drop foto / sketsa barang"
                sub="Satu objek, latar polos = hasil terbaik"
                file={image}
              />
              <Field label="Catatan (opsional)">
                <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="tinggi ±80cm, kaki kayu" className="inp" />
              </Field>
              <AiPicker engines={aiEngines.map((e) => e.id as "gemini" | "claude")} value={ai?.id as "gemini" | "claude" | undefined} onChange={setAiEngine} />
              <button disabled={!claudeOn || !image || !!busy} onClick={() => image && designWithClaude(desc, image)} className="btn-primary">
                <Sparkles size={14} /> Rancang dari gambar ({aiName})
              </button>
              <p className="label-mono text-dim">
                Mau hasil detail/organik? Pakai{" "}
                <Link href="/?mode=image" className="text-accent hover:underline">
                  Image to 3D
                </Link>{" "}
                dengan Tripo, lalu klik <b>Library</b> di kartu Asset Vault.
              </p>
              {!claudeOn && <p className="label-mono text-amber-300">Butuh GEMINI_API_KEY (gratis) atau ANTHROPIC_API_KEY di .env.local.</p>}
            </>
          )}

          {tab === "dict" && <Dictionary dict={lib.dictionary} />}

          {msg && (
            <p className={`rounded-[4px] px-2 py-1.5 text-[11px] ${msg.ok ? "bg-accent/10 text-accent" : "bg-red-500/10 text-red-300"}`}>{msg.text}</p>
          )}
        </div>

        {tab !== "dict" && (
          <div className="bg-strip p-3">
            <button disabled={!pending || !!busy} onClick={save} className="btn-primary w-full">
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} {busy ?? "Simpan ke Library"}
            </button>
          </div>
        )}
      </section>

      {/* Preview */}
      <section className="relative flex h-[45vh] min-h-[300px] min-w-0 flex-1 overflow-hidden rounded-[12px] bg-[rgba(2,6,23,0.8)] lg:h-full lg:min-h-0">
        <div ref={host} className="absolute inset-0" />
        {!pending && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
            <div>
              <Box size={34} className="mx-auto mb-2 text-line" />
              <p className="text-[13px] text-ink">Preview</p>
              <p className="label-mono mt-1 text-dim">Hasil rancangan / file muncul di sini sebelum disimpan.</p>
            </div>
          </div>
        )}
        {busy && (
          <div className="absolute inset-0 grid place-items-center bg-black/30">
            <span className="flex items-center gap-2 text-[13px] text-ink">
              <Loader2 size={16} className="animate-spin" /> {busy}
            </span>
          </div>
        )}
      </section>

      {/* Entries */}
      <section className="flex max-h-[75vh] w-full shrink-0 flex-col overflow-hidden rounded-[8px] bg-panel lg:h-full lg:max-h-none lg:w-[300px] xl:w-[340px]">
        <div className="border-b border-white/5 p-3">
          <h2 className="text-[16px] font-semibold">Isi Library ({lib.entries.length})</h2>
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Cari…" className="inp mt-2" />
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto p-2">
          {entries.length === 0 && <p className="p-4 text-center text-[12px] text-dim">Belum ada knowledge. Tambahkan dari panel kiri.</p>}
          {entries.map((e) => (
            <EntryCard key={e.id} e={e} />
          ))}
        </div>
        <p className="label-mono border-t border-white/5 bg-strip px-3 py-2 text-dim">Tersimpan di folder library/ project kamu</p>
      </section>
    </div>
  );
}

function EntryCard({ e }: { e: LibraryEntry }) {
  const [kw, setKw] = useState(e.keywords.join(", "));
  const dirty = kw !== e.keywords.join(", ");
  return (
    <div className="flex gap-2 rounded-[8px] bg-field p-1.5">
      <div className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-[4px] bg-page">
        {e.hasThumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/api/library/${e.id}/thumb`} alt="" className="size-full object-cover" />
        ) : (
          <Box size={18} className="text-line" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-1">
          <p className="truncate text-[13px] text-ink">{e.label}</p>
          <span className="label-mono shrink-0 text-violet">{e.type === "spec" ? "resep" : e.format?.toUpperCase()}</span>
        </div>
        <input
          value={kw}
          onChange={(ev) => setKw(ev.target.value)}
          className="mt-0.5 w-full rounded-[2px] bg-page px-1 py-0.5 font-mono text-[10px] text-dim outline-none focus:text-ink"
          title="Kata kunci, pisahkan koma"
        />
        <div className="mt-1 flex items-center gap-1">
          <span className="label-mono text-dim">dipakai {e.uses ?? 0}×</span>
          <span className="flex-1" />
          {dirty && (
            <button
              onClick={async () => {
                await fetch(`/api/library/${e.id}`, { method: "PATCH", body: JSON.stringify({ keywords: kw }) });
                refreshLibrary();
              }}
              className="label-mono rounded-[2px] bg-accent/15 px-1 text-accent"
            >
              simpan
            </button>
          )}
          <button
            onClick={async () => {
              if (!window.confirm(`Hapus "${e.label}" dari Library?`)) return;
              await fetch(`/api/library/${e.id}`, { method: "DELETE" });
              refreshLibrary();
            }}
            className="grid size-5 place-items-center rounded-[2px] text-dim hover:text-red-400"
            aria-label="Hapus"
          >
            <Trash2 size={11} />
          </button>
        </div>
      </div>
    </div>
  );
}

function Dictionary({ dict }: { dict: Record<string, string> }) {
  const [word, setWord] = useState("");
  const [en, setEn] = useState("");
  const set = async (w: string, english: string | null) => {
    await fetch("/api/library/dictionary", { method: "POST", body: JSON.stringify({ word: w, english }) });
    refreshLibrary();
  };
  const list = Object.entries(dict).sort((a, b) => a[0].localeCompare(b[0]));
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[12px] text-dim">
        Ajarkan kata/istilah yang belum dikenal. Contoh: <span className="text-ink">lemari jati</span> →{" "}
        <span className="text-ink">teak wood wardrobe</span>. Dipakai semua engine.
      </p>
      <div className="flex gap-1">
        <input value={word} onChange={(e) => setWord(e.target.value)} placeholder="kata Indonesia" className="inp" />
        <input value={en} onChange={(e) => setEn(e.target.value)} placeholder="english" className="inp" />
      </div>
      <button
        disabled={!word.trim() || !en.trim()}
        onClick={async () => {
          await set(word, en);
          setWord("");
          setEn("");
        }}
        className="btn-primary"
      >
        <Save size={13} /> Tambah ke kamus
      </button>
      <div className="flex flex-col gap-1">
        {list.length === 0 && <p className="label-mono text-dim">Kamus masih kosong.</p>}
        {list.map(([k, v]) => (
          <div key={k} className="flex items-center gap-2 rounded-[4px] bg-field px-2 py-1 text-[12px]">
            <span className="text-ink">{k}</span>
            <span className="text-dim">→</span>
            <span className="flex-1 truncate text-accent">{v}</span>
            <button onClick={() => set(k, null)} className="text-dim hover:text-red-400" aria-label={`Hapus ${k}`}>
              <X size={12} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="flex justify-between gap-2">
        <span className="label-mono text-ink">{label}</span>
        {hint && <span className="label-mono truncate text-dim">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

function DropBox(p: { accept: string; label: string; sub: string; file: File | null; onFile: (f: File | null) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <div
      onClick={() => input.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        p.onFile(e.dataTransfer.files?.[0] ?? null);
      }}
      className={`flex cursor-pointer flex-col items-center gap-1 rounded-[6px] border border-dashed p-4 text-center ${
        over ? "border-accent bg-accent/5" : "border-line bg-raised/40 hover:border-dim"
      }`}
    >
      <FileUp size={20} className="text-accent" />
      <span className="text-[12px] text-ink">{p.file ? p.file.name : p.label}</span>
      <span className="label-mono text-dim">{p.file ? `${(p.file.size / 1024 / 1024).toFixed(2)} MB` : p.sub}</span>
      <input
        ref={input}
        type="file"
        accept={p.accept}
        hidden
        onChange={(e) => {
          p.onFile(e.target.files?.[0] ?? null);
          e.target.value = ""; // allow picking the same / another file again
        }}
      />
    </div>
  );
}

function AiPicker(p: { engines: ("gemini" | "claude")[]; value?: "gemini" | "claude"; onChange: (v: "gemini" | "claude") => void }) {
  if (p.engines.length < 2) return null;
  return (
    <div className="flex gap-1 rounded-[4px] bg-field p-0.5">
      {p.engines.map((e) => (
        <button
          key={e}
          type="button"
          onClick={() => p.onChange(e)}
          className={`flex-1 rounded-[2px] py-1 text-[11px] ${p.value === e ? "bg-raised text-accent" : "text-dim hover:text-ink"}`}
        >
          {e === "gemini" ? "Gemini · gratis" : "Claude · berbayar"}
        </button>
      ))}
    </div>
  );
}
