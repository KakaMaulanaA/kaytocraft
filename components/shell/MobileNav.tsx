"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Archive, BookOpen, Image as ImageIcon, Layers, Sparkles } from "lucide-react";

/** Bottom tab bar on phones (the sidebar is hidden below md). */
const TABS = [
  { href: "/?mode=text", label: "Teks", icon: Sparkles, on: (p: string, m: string | null) => p === "/" && m !== "image" },
  { href: "/?mode=image", label: "Gambar", icon: ImageIcon, on: (p: string, m: string | null) => p === "/" && m === "image" },
  { href: "/batch", label: "Batch", icon: Layers, on: (p: string) => p === "/batch" },
  { href: "/library", label: "Library", icon: BookOpen, on: (p: string) => p === "/library" },
  { href: "/?mode=text#vault", label: "Vault", icon: Archive, on: () => false },
];

export function MobileNav() {
  const pathname = usePathname();
  const mode = useSearchParams().get("mode");
  if (pathname === "/login") return null;
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-white/10 bg-page/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
      {TABS.map((t) => {
        const active = t.on(pathname, mode);
        const Icon = t.icon;
        return (
          <Link
            key={t.label}
            href={t.href}
            onClick={() => {
              if (t.href.endsWith("#vault")) setTimeout(() => document.getElementById("vault")?.scrollIntoView({ behavior: "smooth" }), 50);
            }}
            className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] ${active ? "text-accent" : "text-dim"}`}
          >
            <Icon size={18} />
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
