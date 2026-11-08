"use client";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Box, Loader2, Lock } from "lucide-react";

export default function LoginPage() {
  return (
    <Suspense>
      <Login />
    </Suspense>
  );
}

function Login() {
  const next = useSearchParams().get("next");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "Gagal login");
      // Only same-site paths.
      window.location.href = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-page px-4">
      <form onSubmit={submit} className="w-full max-w-[360px] rounded-[12px] bg-panel p-6 shadow-xl">
        <div className="mb-5 flex items-center gap-2">
          <span className="grid size-9 place-items-center rounded-lg bg-gradient-to-br from-accent-deep to-violet text-on-accent">
            <Box size={20} strokeWidth={2.2} />
          </span>
          <div>
            <p className="text-[16px] font-semibold text-ink">KaytoCraft 3D</p>
            <p className="label-mono text-dim">Internal tool — masuk dulu</p>
          </div>
        </div>
        <label className="label-mono mb-1 block text-dim" htmlFor="pw">
          Password
        </label>
        <div className="relative">
          <Lock size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-dim" />
          <input
            id="pw"
            type="password"
            autoFocus
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="inp w-full !pl-8"
          />
        </div>
        {error && <p className="mt-2 text-[12px] text-red-300">{error}</p>}
        <button type="submit" disabled={busy || !password} className="btn-primary mt-4 flex w-full items-center justify-center gap-2">
          {busy && <Loader2 size={14} className="animate-spin" />} Masuk
        </button>
      </form>
    </div>
  );
}
