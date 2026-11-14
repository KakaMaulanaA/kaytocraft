"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  Box,
  ChevronDown,
  Clock,
  CloudUpload,
  Grid3x3,
  Image as ImageIcon,
  Info,
  Layers,
  Loader2,
  TriangleAlert,
  Network,
  SlidersHorizontal,
  Type,
  Wand2,
  X,
  Zap,
} from "lucide-react";
import { DENSITY, PRESETS, PROMPT_MAX, TEXTURE_QUALITY } from "@/lib/presets";
import { smartPrompt } from "@/lib/smartPrompt";
import { SUPPORTED_LABELS, detectProcedural } from "@/lib/procedural/detect";
import type { EngineInfo, GenerateSettings, GenMode, MeshDensity, TextureQuality } from "@/lib/types";
import {
  MATERIAL_CHIPS,
  STYLE_CHIPS,
  TRIPO_COST,
  buildPrompt,
  estimate3D,
  lintSettings,
  sum,
  usd,
  type PromptParts,
} from "@/lib/estimate";

interface Props {
  settings: GenerateSettings;
  onChange: (patch: Partial<GenerateSettings>) => void;
  onModeChange: (mode: GenMode) => void;
  engines: EngineInfo[];
  image: File | null;
  onImage: (f: File | null) => void;
  busy: boolean;
  error: string | null;
  onGenerate: () => void;
  /** Concept-first flow (text mode). */
  conceptFirst: boolean;
  onConceptFirst: (on: boolean) => void;
  conceptCount: number;
  onConceptCount: (n: number) => void;
  onConcepts: () => void;
  balance: number | null;
  dictionary: Record<string, string>;
  libraryHit: string | null;
  libraryCount: number;
  useLibrary: boolean;
  onUseLibrary: (on: boolean) => void;
}

const EST: Record<string, string> = { tripo: "~30–60s", meshy: "~2–4 min", claude: "~20–60s", gemini: "~10–40s", demo: "~1s" };

export function ControlPanel(p: Props) {
  const { settings: s, onChange } = p;
  const [advOpen, setAdvOpen] = useState(false);
  const engine = p.engines.find((e) => e.id === s.engine);
  const canGenerate = !p.busy && (s.mode === "text" ? s.prompt.trim().length > 0 : !!p.image) && !!engine?.available;
  const conceptFlow = s.mode === "text" && p.conceptFirst && !!engine?.supportsConcept;
  const hints = useMemo(() => lintSettings(s), [s]);
  const cost3D = estimate3D(s, conceptFlow ? true : undefined);
  const conceptCost = Math.round(p.conceptCount * TRIPO_COST.concept * 10) / 10;
  const isTripo = engine?.provider === "tripo";
  const nextCost = isTripo ? (conceptFlow ? conceptCost : sum(cost3D ?? [])) : 0;
  const lowBalance = isTripo && p.balance !== null && p.balance < nextCost;

  const smart = s.mode === "text" ? smartPrompt(s.prompt, p.dictionary) : null;
  const isFree = engine?.provider === "demo";
  const freeKind = isFree && smart?.core ? detectProcedural(smart.core)?.label : undefined;
  const fromLib = !!p.libraryHit;
  const geminiOk = !!p.engines.find((e) => e.id === "gemini")?.available;
  const viaGemini = isFree && !fromLib && (s.mode === "image" || (!!smart?.core && !freeKind)) && geminiOk;

  return (
    <section className="flex w-full shrink-0 flex-col overflow-hidden rounded-[8px] bg-panel shadow-xl lg:h-full lg:w-[320px] xl:w-[360px]">
      {/* Header & pipeline switcher */}
      <div className="flex flex-col gap-2 bg-strip p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            <Network size={14} className="text-accent" />
            <h2 className="text-[16px] font-semibold leading-[22px] tracking-[-0.16px]">Synthesis Node</h2>
          </div>
          <span className="flex items-center gap-1 rounded-full bg-accent/10 px-1.5 py-0.5">
            <span className={`size-1.5 rounded-full ${p.busy ? "animate-pulse bg-violet" : "bg-accent"}`} />
            <span className={`label-mono ${p.busy ? "text-violet" : "text-accent"}`}>{p.busy ? "GENERATING" : "IDLE"}</span>
          </span>
        </div>
        <div className="flex gap-1 rounded-[4px] bg-field p-0.5" role="tablist">
          {(["text", "image"] as const).map((m) => (
            <button
              key={m}
              role="tab"
              aria-selected={s.mode === m}
              onClick={() => p.onModeChange(m)}
              className={`flex flex-1 items-center justify-center gap-1 rounded-[2px] px-1.5 py-1 text-[12px] transition-colors ${
                s.mode === m ? "bg-raised text-ink shadow-sm" : "text-dim hover:text-ink"
              }`}
            >
              {m === "text" ? <Type size={13} /> : <ImageIcon size={12} />}
              {m === "text" ? "Text to 3D" : "Image to 3D"}
            </button>
          ))}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        {s.mode === "image" && <Dropzone file={p.image} onFile={p.onImage} />}

        {/* The one thing that matters: what to make */}
        <div className="flex flex-col gap-1.5">
          <span className="label-mono uppercase tracking-[0.5px] text-ink">
            {s.mode === "text" ? "Mau bikin apa?" : "Nama aset (opsional)"}
          </span>
          <div className="rounded-[6px] bg-field p-2.5 focus-within:ring-1 focus-within:ring-accent/50">
            <textarea
              value={s.prompt}
              maxLength={PROMPT_MAX}
              autoFocus={s.mode === "text"}
              onChange={(e) => onChange({ prompt: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && canGenerate && (!lowBalance || fromLib)) {
                  e.preventDefault();
                  (conceptFlow && !fromLib ? p.onConcepts : p.onGenerate)();
                }
              }}
              rows={s.mode === "text" ? 3 : 1}
              placeholder={s.mode === "text" ? "Contoh: meja kayu bulat" : "Mis. Kursi Rotan"}
              className="w-full resize-none bg-transparent text-[14px] leading-[20px] text-ink outline-none placeholder:text-dim/50"
            />
          </div>
          {smart?.core && (
            <p className="label-mono text-dim" title={smart.final}>
              {isFree ? "Dibaca sebagai" : "AI membaca"}: <span className="text-accent">{smart.core}</span>
            </p>
          )}
          {fromLib && (
            <p className="label-mono text-violet">📚 Ada di Library: {p.libraryHit} — dipakai gratis</p>
          )}
          {!fromLib && isFree && s.mode === "text" && smart?.core && (
            freeKind ? (
              <p className="label-mono text-accent">✓ Mode Gratis bisa membuat: {freeKind}</p>
            ) : geminiOk ? (
              <p className="label-mono text-accent">✓ Akan dirancang Gemini (gratis, ~10–40s)</p>
            ) : (
              <p className="label-mono text-amber-300">
                ✗ Belum didukung Mode Gratis. Bisa: {SUPPORTED_LABELS.join(", ")}. Objek lain → pilih engine Gemini (gratis), Claude, atau Tripo di Pengaturan lanjutan.
              </p>
            )
          )}
          {s.mode === "text" && !s.prompt.trim() && (
            <div className="flex flex-wrap gap-1">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  onClick={() => onChange({ prompt: ex })}
                  className="rounded-full border border-line px-2 py-0.5 text-[11px] text-dim hover:border-dim hover:text-ink"
                >
                  {ex}
                </button>
              ))}
            </div>
          )}
          <p className="label-mono text-dim/70">Enter untuk generate. Boleh pakai bahasa Indonesia.</p>
        </div>

        {/* Everything else stays out of the way */}
        <div className="rounded-[6px] border border-line/60">
          <button
            type="button"
            onClick={() => setAdvOpen((v) => !v)}
            className="flex w-full items-center justify-between px-2.5 py-2"
          >
            <span className="flex items-center gap-1.5 text-[12px] text-dim">
              <SlidersHorizontal size={13} /> Pengaturan lanjutan
            </span>
            <span className="label-mono flex items-center gap-1 text-dim">
              {advOpen ? "tutup" : "opsional"}
              <ChevronDown size={13} className={`transition-transform ${advOpen ? "rotate-180" : ""}`} />
            </span>
          </button>

          {advOpen && (
            <div className="flex flex-col gap-3 border-t border-line/60 p-2.5">
              <label className="flex cursor-pointer items-center justify-between rounded-[4px] bg-field px-2 py-1.5 text-[12px] text-ink">
                <span className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={p.useLibrary}
                    onChange={(e) => p.onUseLibrary(e.target.checked)}
                    className="size-3.5 accent-[#4edea3]"
                  />
                  Pakai Knowledge Library dulu
                </span>
                <span className="label-mono text-dim">{p.libraryCount} entri</span>
              </label>

              {s.mode === "text" && engine?.supportsConcept && (
                <div className="flex items-center justify-between rounded-[4px] bg-field px-2 py-1.5">
                  <label className="flex cursor-pointer items-center gap-1.5 text-[12px] text-ink" title="Lihat gambar 2D murah dulu, pilih yang cocok, baru jadikan 3D.">
                    <input
                      type="checkbox"
                      checked={p.conceptFirst}
                      onChange={(e) => p.onConceptFirst(e.target.checked)}
                      className="size-3.5 accent-[#4edea3]"
                    />
                    Pilih konsep 2D dulu
                  </label>
                  {p.conceptFirst && (
                    <span className="flex items-center gap-0.5">
                      {[1, 2, 3, 4].map((n) => (
                        <button
                          key={n}
                          type="button"
                          onClick={() => p.onConceptCount(n)}
                          className={`label-mono size-5 rounded-[2px] ${p.conceptCount === n ? "bg-raised text-accent" : "text-dim hover:text-ink"}`}
                          aria-label={`${n} konsep`}
                        >
                          {n}
                        </button>
                      ))}
                    </span>
                  )}
                </div>
              )}

              {s.mode === "text" && <PromptBuilder onApply={(prompt) => onChange({ prompt })} />}

              {s.mode === "text" && (
                <div className="flex flex-col gap-1">
                  <span className="label-mono text-dim">Preset gaya</span>
                  <div className="flex flex-wrap gap-1">
                    {PRESETS.map((pr) => {
                      const on = s.presets.includes(pr.id);
                      return (
                        <button
                          key={pr.id}
                          type="button"
                          title={pr.tags}
                          onClick={() => onChange({ presets: on ? s.presets.filter((x) => x !== pr.id) : [...s.presets, pr.id] })}
                          className={`rounded-full border px-2 py-0.5 text-[11px] transition-colors ${
                            on ? "border-accent/60 bg-accent/10 text-accent" : "border-line text-dim hover:text-ink"
                          }`}
                        >
                          {pr.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {s.mode === "text" && (
                <Field label="Hindari (opsional)">
                  <input
                    value={s.negativePrompt ?? ""}
                    maxLength={255}
                    onChange={(e) => onChange({ negativePrompt: e.target.value })}
                    placeholder="text, logo, base plate"
                    className="rounded-[4px] bg-field px-2 py-1.5 text-[12px] outline-none placeholder:text-dim/40"
                  />
                </Field>
              )}

              <Field label="Engine">
                <Select
                  icon={<Box size={13} className="text-accent" />}
                  value={s.engine}
                  onChange={(v) => onChange({ engine: v as GenerateSettings["engine"] })}
                  options={p.engines.map((e) => ({
                    value: e.id,
                    label: e.available ? e.label : `${e.label} — perlu API key`,
                    disabled: !e.available,
                  }))}
                />
              </Field>

              <Field label="Kepadatan mesh">
                <Select
                  icon={<Grid3x3 size={13} className="text-violet" />}
                  value={s.density}
                  onChange={(v) => onChange({ density: v as MeshDensity })}
                  options={Object.entries(DENSITY).map(([k, d]) => ({ value: k, label: d.label }))}
                />
              </Field>

              <Field label="Kualitas tekstur">
                <div className="flex gap-1 rounded-[4px] bg-field p-0.5">
                  {(Object.keys(TEXTURE_QUALITY) as TextureQuality[]).map((q) => (
                    <button
                      key={q}
                      type="button"
                      onClick={() => onChange({ textureQuality: q })}
                      className={`flex-1 rounded-[2px] py-1 font-mono text-[11px] leading-[14px] ${
                        s.textureQuality === q ? "bg-raised text-accent shadow-sm" : "text-dim hover:text-ink"
                      }`}
                    >
                      {TEXTURE_QUALITY[q]}
                    </button>
                  ))}
                </div>
              </Field>

              <div className="grid grid-cols-2 gap-1.5">
                <Toggle label="PBR Material" sub="Metal / Rough maps" on={s.pbr} onToggle={() => onChange({ pbr: !s.pbr })} />
                <Toggle label="Quad-Remesh" sub="Output FBX quads" on={s.quad} onToggle={() => onChange({ quad: !s.quad })} />
                <Toggle
                  label="Smart Low-Poly"
                  sub="Objek sederhana"
                  on={s.smartLowPoly}
                  onToggle={() => onChange({ smartLowPoly: !s.smartLowPoly })}
                />
              </div>

              {hints.length > 0 && (
                <div className="flex flex-col gap-1">
                  {hints.map((h) => (
                    <p
                      key={h.text}
                      className={`flex gap-1.5 rounded-[4px] px-2 py-1.5 text-[11px] leading-[15px] ${
                        h.level === "warn" ? "bg-amber-400/10 text-amber-200" : "bg-field text-dim"
                      }`}
                    >
                      {h.level === "warn" ? <TriangleAlert size={12} className="mt-px shrink-0" /> : <Info size={12} className="mt-px shrink-0" />}
                      {h.text}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Generate */}
      <div className="flex flex-col gap-1.5 bg-strip p-3">
        {p.error && (
          <div className="flex items-start gap-1.5 rounded-[4px] border border-red-500/30 bg-red-500/10 p-2 text-[11px] text-red-300">
            <X size={13} className="mt-px shrink-0" /> <span className="break-words">{p.error}</span>
          </div>
        )}
        <button
          type="button"
          disabled={!canGenerate || (lowBalance && !fromLib)}
          onClick={conceptFlow && !fromLib ? p.onConcepts : p.onGenerate}
          className="relative flex w-full items-center justify-center gap-1.5 rounded-[8px] bg-gradient-to-r from-accent-deep via-accent to-violet px-3 py-2.5 text-[16px] font-semibold tracking-[-0.16px] text-on-accent shadow-[0_20px_25px_-5px_rgba(16,185,129,0.2)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
        >
          {p.busy ? <Loader2 size={16} className="animate-spin" /> : <Zap size={15} />}
          {p.busy ? "Mengirim…" : fromLib ? "Generate dari Library" : conceptFlow ? `Buat ${p.conceptCount} Konsep 2D` : "Generate 3D"}
          {!p.busy && (conceptFlow ? <Layers size={13} /> : <ArrowRight size={13} />)}
        </button>
        <div className="flex items-center justify-between px-1">
          <span className="label-mono flex items-center gap-0.5 text-dim">
            <Clock size={11} /> {fromLib ? "~1s" : viaGemini ? EST.gemini : EST[engine?.provider ?? "demo"]}
          </span>
          {fromLib ? (
            <span className="label-mono text-accent">Gratis · Library</span>
          ) : (
          <CostLine
            isTripo={isTripo}
            isDemo={engine?.provider === "demo"}
            isClaude={engine?.provider === "claude"}
            isGemini={engine?.provider === "gemini"}
            conceptFlow={conceptFlow}
            conceptCost={conceptCost}
            cost3D={cost3D}
            balance={p.balance}
            low={lowBalance}
          />
          )}
        </div>
      </div>
    </section>
  );
}

const EXAMPLES = ["meja kayu bulat", "kursi kantor hitam", "pedang kuno", "peti harta karun", "lampu meja modern"];

function CostLine(p: {
  isTripo: boolean;
  isDemo: boolean;
  isClaude: boolean;
  isGemini: boolean;
  conceptFlow: boolean;
  conceptCost: number;
  cost3D: { label: string; credits: number }[] | null;
  balance: number | null;
  low: boolean;
}) {
  if (p.isDemo) return <span className="label-mono text-accent">Gratis</span>;
  if (p.isClaude) return <span className="label-mono text-dim">Claude API · per token</span>;
  if (p.isGemini) return <span className="label-mono text-accent">Gratis · kuota Google</span>;
  if (!p.isTripo || !p.cost3D) return <span className="label-mono text-dim">Biaya: lihat dashboard</span>;
  const now = p.conceptFlow ? p.conceptCost : sum(p.cost3D);
  return (
    <span
      className={`label-mono ${p.low ? "text-red-300" : "text-dim"}`}
      title={p.cost3D.map((l) => `${l.label} ${l.credits}`).join(" + ")}
    >
      ≈{now} kr ({usd(now)}) · saldo {p.balance ?? "?"}
      {p.low && " — kurang"}
    </span>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="flex justify-between">
        <span className="label-mono text-dim">{label}</span>
        {hint && <span className="label-mono text-dim">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

function Select(props: {
  icon: React.ReactNode;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string; disabled?: boolean }[];
}) {
  return (
    <span className="relative flex items-center rounded-[4px] bg-field">
      <span className="pointer-events-none absolute left-2">{props.icon}</span>
      <select
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        className="w-full appearance-none bg-transparent py-1.5 pl-7 pr-7 text-[12px] text-ink outline-none"
      >
        {props.options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled} className="bg-field">
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown size={13} className="pointer-events-none absolute right-2 text-dim" />
    </span>
  );
}

function Toggle({ label, sub, on, onToggle }: { label: string; sub: string; on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onToggle}
      className="flex items-center gap-1.5 rounded-[4px] bg-raised/40 p-1.5 text-left hover:bg-raised/70"
    >
      <span
        className={`grid size-4 shrink-0 place-items-center rounded-[2.5px] ${on ? "bg-accent" : "border border-line bg-field"}`}
      >
        {on && <span className="text-[10px] font-bold leading-none text-on-accent">✓</span>}
      </span>
      <span className="min-w-0">
        <span className="block text-[12px] leading-[16px] text-ink">{label}</span>
        <span className="label-mono block truncate text-dim">{sub}</span>
      </span>
    </button>
  );
}

function Dropzone({ file, onFile }: { file: File | null; onFile: (f: File | null) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);

  const accept = (f?: File | null) => {
    if (f && ["image/png", "image/jpeg", "image/webp"].includes(f.type)) onFile(f);
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="label-mono uppercase tracking-[0.5px] text-ink">Reference Ingest</span>
        <span className="label-mono text-violet">Single View</span>
      </div>
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
          accept(e.dataTransfer.files?.[0]);
        }}
        className={`relative flex cursor-pointer flex-col items-center justify-center rounded-[4px] border border-dashed p-3 text-center transition-colors ${
          over ? "border-accent bg-accent/5" : "border-line bg-raised/60 hover:border-dim"
        }`}
      >
        {preview ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview} alt="Reference" className="max-h-44 rounded object-contain" />
            <span className="label-mono mt-2 max-w-full truncate text-dim">{file?.name}</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onFile(null);
              }}
              className="absolute right-1.5 top-1.5 grid size-6 place-items-center rounded bg-page/80 text-dim hover:text-ink"
              aria-label="Hapus gambar"
            >
              <X size={13} />
            </button>
          </>
        ) : (
          <>
            <span className="mb-1 grid size-10 place-items-center rounded-[12px] bg-line text-accent">
              <CloudUpload size={18} />
            </span>
            <span className="text-[12px] leading-[16px] text-ink">Drop reference sketch or photo</span>
            <span className="label-mono text-dim">PNG, JPG, WebP (maks 20MB)</span>
            <span className="label-mono mt-1.5 rounded-full bg-field px-1.5 py-0.5 text-accent">
              Objek tunggal, latar polos = hasil terbaik
            </span>
          </>
        )}
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          onChange={(e) => accept(e.target.files?.[0])}
        />
      </div>
    </div>
  );
}


function PromptBuilder({ onApply }: { onApply: (prompt: string) => void }) {
  const [open, setOpen] = useState(false);
  const [parts, setParts] = useState<PromptParts>({ object: "", shape: "", material: "", style: "" });
  const set = (k: keyof PromptParts) => (v: string) => setParts((x) => ({ ...x, [k]: v }));
  const preview = buildPrompt(parts);

  return (
    <div className="rounded-[4px] border border-line/70">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-2 py-1.5"
      >
        <span className="label-mono flex items-center gap-1 uppercase tracking-[0.5px] text-ink">
          <Wand2 size={12} className="text-violet" /> Prompt Builder
        </span>
        <span className="label-mono flex items-center gap-1 text-dim">
          isi 4 kolom <ChevronDown size={13} className={`transition-transform ${open ? "rotate-180" : ""}`} />
        </span>
      </button>
      {open && (
        <div className="flex flex-col gap-1.5 border-t border-line/70 p-2">
          <BuilderInput label="1. Objek" placeholder="dining table / armchair / sci-fi crate" value={parts.object} onChange={set("object")} />
          <BuilderInput label="2. Bentuk & detail" placeholder="rectangular top, four square legs, rounded corners" value={parts.shape} onChange={set("shape")} />
          <BuilderInput label="3. Material" placeholder="oak wood" value={parts.material} onChange={set("material")} chips={MATERIAL_CHIPS} />
          <BuilderInput label="4. Gaya" placeholder="modern minimalist" value={parts.style} onChange={set("style")} chips={STYLE_CHIPS} />
          {preview && <p className="rounded-[2px] bg-page px-2 py-1 text-[11px] leading-[15px] text-dim">{preview}</p>}
          <button
            type="button"
            disabled={!parts.object.trim()}
            onClick={() => {
              onApply(preview);
              setOpen(false);
            }}
            className="rounded-[4px] bg-raised py-1 text-[12px] text-accent hover:brightness-125 disabled:opacity-40"
          >
            Pakai sebagai prompt ↓
          </button>
        </div>
      )}
    </div>
  );
}

function BuilderInput(p: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  chips?: string[];
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="label-mono text-dim">{p.label}</span>
      <input
        value={p.value}
        onChange={(e) => p.onChange(e.target.value)}
        placeholder={p.placeholder}
        className="rounded-[2px] bg-field px-2 py-1 text-[12px] text-ink outline-none placeholder:text-dim/40 focus:ring-1 focus:ring-accent/50"
      />
      {p.chips && (
        <div className="flex flex-wrap gap-0.5">
          {p.chips.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => p.onChange(c)}
              className={`rounded-full px-1.5 text-[10px] leading-[16px] ${
                p.value === c ? "bg-accent/15 text-accent" : "bg-page text-dim hover:text-ink"
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
