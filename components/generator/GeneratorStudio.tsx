"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ControlPanel } from "./ControlPanel";
import { Viewport } from "./Viewport";
import { AssetVault } from "./AssetVault";
import { ConceptBoard } from "./ConceptBoard";
import { estimate3D, sum, usd } from "@/lib/estimate";
import { smartPrompt } from "@/lib/smartPrompt";
import { SUPPORTED_LABELS, detectProcedural } from "@/lib/procedural/detect";
import { applyVariation, matchLibrary, type LibraryEntry } from "@/lib/library";
import { groupToGlb, refreshLibrary, useLibrary } from "@/lib/useLibrary";
import { refreshConfig, useConfig } from "@/lib/useConfig";
import type { Asset, AssetStats, Concept, GenerateSettings, GenMode } from "@/lib/types";
import type { ModelViewer } from "@/lib/three/viewer";
import { appendFile } from "@/lib/upload";
import { requestDesign } from "@/lib/designClient";

// v2: reset old drafts to the cheaper defaults (Standard texture, no Smart Low-Poly).
const DRAFT_KEY = "kc:draft:v3";
const FLOW_KEY = "kc:flow:v2";

const DEFAULTS: GenerateSettings = {
  mode: "text",
  prompt: "",
  negativePrompt: "",
  engine: "demo",
  density: "balanced",
  textureQuality: "standard",
  pbr: true,
  quad: false,
  smartLowPoly: false,
  presets: [],
};

export function GeneratorStudio() {
  const router = useRouter();
  const params = useSearchParams();
  const mode: GenMode = params.get("mode") === "image" ? "image" : "text";
  const wantAsset = params.get("asset");
  const config = useConfig();
  const library = useLibrary();
  const [useLib, setUseLib] = useState(true);

  const [settings, setSettings] = useState<GenerateSettings>({ ...DEFAULTS, mode });
  const [image, setImage] = useState<File | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const engineTouched = useRef(false);
  const [conceptFirst, setConceptFirst] = useState(false);
  const [conceptCount, setConceptCount] = useState(2);
  const [concepts, setConcepts] = useState<Concept[]>([]);
  const [conceptPrompt, setConceptPrompt] = useState("");
  const [boardOpen, setBoardOpen] = useState(false);

  useEffect(() => {
    try {
      const f = JSON.parse(localStorage.getItem(FLOW_KEY) || "null");
      if (f) {
        setConceptFirst(!!f.conceptFirst);
        setConceptCount(Math.min(4, Math.max(1, Number(f.conceptCount) || 2)));
        if (typeof f.useLib === "boolean") setUseLib(f.useLib);
      }
    } catch {}
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(FLOW_KEY, JSON.stringify({ conceptFirst, conceptCount, useLib }));
    } catch {}
  }, [conceptFirst, conceptCount, useLib]);

  const toast = useCallback((m: string) => {
    setToastMsg(m);
    window.setTimeout(() => setToastMsg((cur) => (cur === m ? null : cur)), 3200);
  }, []);

  // URL is the source of truth for the pipeline mode (sidebar links use it).
  useEffect(() => setSettings((s) => ({ ...s, mode })), [mode]);

  // Restore draft prompt/settings (per-browser convenience only).
  useEffect(() => {
    try {
      const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null");
      if (d) setSettings((s) => ({ ...s, ...d, mode: s.mode }));
      if (d?.engine) engineTouched.current = true;
    } catch {}
  }, []);
  useEffect(() => {
    try {
      const { mode: _m, ...rest } = settings;
      localStorage.setItem(DRAFT_KEY, JSON.stringify(rest));
    } catch {}
  }, [settings]);

  // Pick the best available engine once config arrives (unless the user chose one).
  useEffect(() => {
    if (!config) return;
    setSettings((s) => {
      const cur = config.engines.find((e) => e.id === s.engine);
      if (engineTouched.current && cur?.available) return s;
      return { ...s, engine: config.defaultEngine };
    });
  }, [config]);

  // Initial history load.
  useEffect(() => {
    fetch("/api/assets", { cache: "no-store" })
      .then((r) => r.json())
      .then((list: Asset[]) => {
        setAssets(list);
        // ?asset=<id> (e.g. "Lihat" from Batch) opens that model.
        const first = list.find((a) => a.id === wantAsset) ?? list.find((a) => a.status === "ready") ?? list[0];
        if (first) setActiveId((cur) => cur ?? first.id);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const upsert = useCallback((a: Asset) => {
    setAssets((list) => {
      const i = list.findIndex((x) => x.id === a.id);
      if (i < 0) return [a, ...list];
      const next = list.slice();
      next[i] = a;
      return next;
    });
  }, []);

  // Poll every pending job.
  const pendingIds = assets.filter((a) => a.status === "queued" || a.status === "running").map((a) => a.id);
  const pendingKey = pendingIds.join(",");
  useEffect(() => {
    if (!pendingKey) return;
    let stop = false;
    const tick = async () => {
      await Promise.all(
        pendingKey.split(",").map(async (id) => {
          try {
            const res = await fetch(`/api/tasks/${id}`, { cache: "no-store" });
            if (!res.ok) return;
            const a: Asset = await res.json();
            if (stop) return;
            upsert(a);
            if (a.status === "ready") {
              refreshConfig();
              toast(`✓ ${a.name} siap`);
            }
          } catch {}
        }),
      );
    };
    const t = window.setInterval(tick, 2000);
    tick();
    return () => {
      stop = true;
      window.clearInterval(t);
    };
  }, [pendingKey, upsert, toast]);

  // ---- concept-first flow ------------------------------------------------
  const makeConcepts = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/concepts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: settings.prompt, engine: settings.engine, count: conceptCount }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || "Gagal membuat konsep.");
      setConcepts(body);
      setConceptPrompt(settings.prompt);
      setBoardOpen(true);
      refreshConfig();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const conceptKey = concepts.filter((c) => c.status === "running").map((c) => c.id).join(",");
  useEffect(() => {
    if (!conceptKey) return;
    let stop = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/concepts?ids=${conceptKey}`, { cache: "no-store" });
        const list: Concept[] = await res.json();
        if (stop) return;
        setConcepts((cur) => cur.map((c) => list.find((x) => x.id === c.id) ?? c));
      } catch {}
    };
    const t = window.setInterval(tick, 1500);
    tick();
    return () => {
      stop = true;
      window.clearInterval(t);
    };
  }, [conceptKey]);

  /** Free mode: build the model in the browser, export GLB, store it like any other asset. */
  const generateFree = async () => {
    setError(null);
    if (settings.mode === "image") {
      setError("Mode Gratis hanya untuk teks. Untuk Image to 3D pilih engine Tripo, atau pakai Import GLB di Asset Vault.");
      return;
    }
    const core = smartPrompt(settings.prompt, library.dictionary).core;
    const params = detectProcedural(core);
    if (!params) {
      const alt = config?.engines.find((e) => e.id === "gemini")?.available
        ? "Gemini (gratis)"
        : config?.engines.find((e) => e.id === "claude")?.available
          ? "Claude atau Tripo"
          : "Tripo";
      setError(`"${core}" belum didukung Mode Gratis. Yang bisa: ${SUPPORTED_LABELS.join(", ")}. Untuk objek lain pilih engine ${alt}.`);
      return;
    }
    setBusy(true);
    try {
      const { buildProcedural } = await import("@/lib/procedural/build");
      const saved = await saveGroup(buildProcedural(params), "procedural", settings.prompt);
      toast(`✓ ${saved.name} jadi (gratis)`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  /** Export a three.js group to GLB and store it as an asset. */
  const saveGroup = async (
    group: import("three").Group,
    source: "procedural" | "claude" | "gemini" | "library",
    prompt: string,
    spec?: unknown,
  ) => {
    const fd = new FormData();
    await appendFile(fd, "file", await groupToGlb(group), `${source}.glb`);
    fd.append("source", source);
    fd.append("prompt", prompt);
    if (spec) fd.append("spec", JSON.stringify(spec));
    const res = await fetch("/api/assets/upload", { method: "POST", body: fd });
    const body = await res.json();
    if (!res.ok) throw new Error(body?.error || "Gagal menyimpan model.");
    upsert(body);
    setActiveId(body.id);
    refreshConfig();
    return body as Asset;
  };

  /** Claude / Gemini: the AI designs a parts recipe on the server, the browser builds it. */
  const generateDesign = async (engine: "claude" | "gemini") => {
    setError(null);
    if (settings.mode === "image" && !image) {
      setError("Unggah gambar referensi dulu.");
      return;
    }
    setBusy(true);
    const started = Date.now();
    try {
      let img: { mediaType: string; data: string } | undefined;
      if (settings.mode === "image" && image) {
        const buf = new Uint8Array(await image.arrayBuffer());
        let bin = "";
        for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
        img = { mediaType: image.type, data: btoa(bin) };
      }
      const who = engine === "gemini" ? "Gemini" : "Claude";
      toast(`${who} sedang merancang model…`);
      const body = await requestDesign({ engine, prompt: settings.prompt, image: img }, who);
      const { buildFromSpec } = await import("@/lib/procedural/fromSpec");
      const prompt = settings.prompt || body.spec.name;
      const saved = await saveGroup(buildFromSpec(body.spec), engine, prompt, body.spec);
      const secs = Math.round((Date.now() - started) / 1000);
      const tok = body.usage ? ` · ${body.usage.input_tokens + body.usage.output_tokens} token` : "";
      toast(`✓ ${saved.name}: ${body.spec.parts.length} part, ${secs}s${tok}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const importModel = async (file: File) => {
    const fd = new FormData();
    try {
      await appendFile(fd, "file", file, file.name);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    fd.append("source", "import");
    const res = await fetch("/api/assets/upload", { method: "POST", body: fd });
    const body = await res.json();
    if (!res.ok) {
      toast(body?.error || "Import gagal");
      return;
    }
    upsert(body);
    setActiveId(body.id);
    refreshConfig();
    toast(`✓ ${body.name} di-import`);
  };

  /** Reuse a Knowledge Library entry (free). Spec entries are re-skinned from the prompt. */
  const generateFromLibrary = async (entry: LibraryEntry) => {
    setError(null);
    setBusy(true);
    try {
      if (entry.type === "spec") {
        const spec = await (await fetch(`/api/library/${entry.id}/spec`)).json();
        const { buildFromSpec } = await import("@/lib/procedural/fromSpec");
        const varied = applyVariation(spec, settings.prompt, entry.keywords);
        const saved = await saveGroup(buildFromSpec(varied), "library", settings.prompt || entry.label, varied);
        fetch(`/api/library/${entry.id}/use`, { method: "POST", body: "{}" }).catch(() => {});
        toast(`📚 ${saved.name} dari Library (gratis)`);
      } else {
        const res = await fetch(`/api/library/${entry.id}/use`, { method: "POST", body: JSON.stringify({ prompt: settings.prompt }) });
        const body = await res.json();
        if (!res.ok) throw new Error(body?.error || "Gagal memakai Library");
        upsert(body);
        setActiveId(body.id);
        refreshConfig();
        toast(`📚 ${body.name} dari Library (gratis)`);
      }
      refreshLibrary();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const saveToLibrary = async (a: Asset) => {
    const kw = window.prompt(
      `Simpan "${a.name}" ke Knowledge Library.\nKata kunci (pisahkan dengan koma), mis. "sofa, sofa kulit, couch":`,
      a.settings.prompt || a.name.toLowerCase(),
    );
    if (!kw) return;
    const fd = new FormData();
    fd.append("label", a.name);
    fd.append("keywords", kw);
    fd.append("origin", "vault");
    fd.append("fromAsset", a.id);
    const res = await fetch("/api/library", { method: "POST", body: fd });
    const body = await res.json();
    if (!res.ok) return toast(body?.error || "Gagal menyimpan");
    refreshLibrary();
    toast(`📚 "${body.label}" masuk Library — ketik kata kuncinya untuk pakai gratis`);
  };

  const libraryHit =
    useLib && settings.mode === "text" && settings.prompt.trim()
      ? matchLibrary(library.entries, settings.prompt, smartPrompt(settings.prompt, library.dictionary).core)
      : null;

  const generate = async (conceptId?: string) => {
    if (!conceptId && libraryHit) return generateFromLibrary(libraryHit);
    if (!conceptId && settings.engine === "demo") return generateFree();
    if (!conceptId && (settings.engine === "claude" || settings.engine === "gemini")) return generateDesign(settings.engine);
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("settings", JSON.stringify(conceptId ? { ...settings, prompt: conceptPrompt || settings.prompt } : settings));
      if (conceptId) fd.append("conceptId", conceptId);
      else if (settings.mode === "image" && image) await appendFile(fd, "image", image, image.name);
      const res = await fetch("/api/generate", { method: "POST", body: fd });
      const body = await res.json();
      if (body?.id) {
        upsert(body);
        setActiveId(body.id);
        if (conceptId) setBoardOpen(false);
      }
      if (!res.ok) setError(body?.error || "Gagal memulai generate.");
      refreshConfig();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setBusy(false);
    }
  };

  // After the viewer loads a model: store measured stats + a thumbnail if missing.
  const onLoaded = useCallback(
    async (a: Asset, stats: AssetStats, viewer: ModelViewer) => {
      if (!a.stats) {
        fetch(`/api/assets/${a.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stats }),
        })
          .then((r) => r.json())
          .then(upsert)
          .catch(() => {});
      }
      if (!a.hasThumb) {
        await new Promise((r) => setTimeout(r, 250));
        const blob = await viewer.snapshot();
        if (blob) {
          await fetch(`/api/assets/${a.id}/thumb`, { method: "POST", body: blob });
          upsert({ ...a, stats, hasThumb: true, completedAt: Date.now() });
        }
      }
    },
    [upsert],
  );

  const remove = async (a: Asset) => {
    if (!window.confirm(`Hapus "${a.name}" dari vault? File model ikut terhapus.`)) return;
    await fetch(`/api/assets/${a.id}`, { method: "DELETE" });
    setAssets((l) => l.filter((x) => x.id !== a.id));
    if (activeId === a.id) setActiveId(null);
    refreshConfig();
  };

  const reuse = (a: Asset) => {
    const { mode: _m, ...rest } = a.settings;
    setSettings((s) => ({ ...s, ...rest, mode: "text" }));
    if (mode !== "text") router.replace("/?mode=text");
    toast("Prompt & setelan dimuat ke panel.");
  };

  const active = assets.find((a) => a.id === activeId) ?? null;
  const cost3D = estimate3D(settings, true);
  const cost3DLabel = cost3D ? `≈${sum(cost3D)} kr · ${usd(sum(cost3D))}` : null;

  return (
    <div className="flex h-full gap-2">
      <ControlPanel
        settings={settings}
        onChange={(patch) => {
          if (patch.engine) engineTouched.current = true;
          setSettings((s) => ({ ...s, ...patch }));
        }}
        onModeChange={(m) => router.replace(`/?mode=${m}`)}
        engines={config?.engines ?? []}
        image={image}
        onImage={setImage}
        busy={busy}
        error={error}
        onGenerate={() => generate()}
        conceptFirst={conceptFirst}
        onConceptFirst={setConceptFirst}
        conceptCount={conceptCount}
        onConceptCount={setConceptCount}
        onConcepts={makeConcepts}
        balance={config?.balance ?? null}
        dictionary={library.dictionary}
        libraryHit={libraryHit?.label ?? null}
        libraryCount={library.entries.length}
        useLibrary={useLib}
        onUseLibrary={setUseLib}
      />
      <div className="relative flex h-full min-w-0 flex-1">
        <Viewport asset={active} onLoaded={onLoaded} toast={toast} />
        {boardOpen && concepts.length > 0 && (
          <ConceptBoard
            concepts={concepts}
            prompt={conceptPrompt}
            cost3D={cost3DLabel}
            busy={busy}
            onPick={(c) => generate(c.id)}
            onRetry={makeConcepts}
            onClose={() => setBoardOpen(false)}
          />
        )}
        {!boardOpen && concepts.some((c) => c.status === "ready") && (
          <button
            type="button"
            onClick={() => setBoardOpen(true)}
            className="label-mono absolute left-3 top-[84px] z-10 rounded-[4px] border border-white/10 bg-[rgba(10,14,23,0.85)] px-2 py-1 text-accent hover:bg-raised"
          >
            ← Lihat konsep terakhir
          </button>
        )}
      </div>
      <AssetVault
        assets={assets}
        activeId={activeId}
        onSelect={(a) => setActiveId(a.id)}
        onDelete={remove}
        onReuse={reuse}
        onImport={importModel}
        onSaveToLibrary={saveToLibrary}
        storageUsed={config?.storage.used ?? 0}
      />
      {toastMsg && (
        <div className="fixed bottom-5 right-5 z-50 rounded-[8px] border border-white/10 bg-strip px-3 py-2 text-[12px] text-ink shadow-2xl">
          {toastMsg}
        </div>
      )}
    </div>
  );
}
