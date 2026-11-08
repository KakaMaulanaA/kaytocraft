import type { Metadata } from "next";
import { Suspense } from "react";
import "@fontsource-variable/inter";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "./globals.css";
import { Header } from "@/components/shell/Header";
import { Sidebar } from "@/components/shell/Sidebar";

export const metadata: Metadata = {
  title: "KaytoCraft 3D — Generator",
  description: "Internal AI-assisted 3D studio: Text/Image to 3D → Blender",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body className="h-screen overflow-hidden">
        <Header />
        <div className="flex h-[calc(100vh-56px)]">
          <Suspense fallback={<aside className="w-14 shrink-0 2xl:w-64" />}>
            <Sidebar />
          </Suspense>
          <main className="min-w-0 flex-1 p-3 pl-2">{children}</main>
        </div>
      </body>
    </html>
  );
}
