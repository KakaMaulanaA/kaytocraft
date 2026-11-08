import Link from "next/link";
import { ArrowLeft, Construction } from "lucide-react";

export function ComingSoon({ title, phase, points }: { title: string; phase: number; points: string[] }) {
  return (
    <div className="grid h-full place-items-center rounded-[8px] bg-panel">
      <div className="max-w-md p-6">
        <span className="label-mono rounded-full bg-violet/10 px-2 py-0.5 text-violet">ROADMAP · FASE {phase}</span>
        <h1 className="mt-3 flex items-center gap-2 text-[22px] font-semibold tracking-tight">
          <Construction size={20} className="text-accent" /> {title}
        </h1>
        <p className="mt-2 text-[13px] text-dim">Modul ini dijadwalkan setelah Generator MVP (Fase 1) stabil. Rencana isinya:</p>
        <ul className="mt-3 space-y-1.5 text-[13px] text-ink">
          {points.map((p) => (
            <li key={p} className="flex gap-2">
              <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-accent" />
              {p}
            </li>
          ))}
        </ul>
        <Link href="/" className="mt-5 inline-flex items-center gap-1 text-[12px] text-accent hover:underline">
          <ArrowLeft size={13} /> Kembali ke Generator
        </Link>
      </div>
    </div>
  );
}
