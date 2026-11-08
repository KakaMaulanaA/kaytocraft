import { NextResponse } from "next/server";
import { defaultEngine, engineList, tripoBalance } from "@/lib/server/providers";
import { listAssets, storageUsage } from "@/lib/server/storage";
import type { AppConfig } from "@/lib/types";
import { blendSupported } from "@/lib/server/blender";
import { remoteBlendReady } from "@/lib/server/blendRemote";
import { isHosted } from "@/lib/server/blobstore";

export const dynamic = "force-dynamic";

export async function GET() {
  const [assets, balance] = await Promise.all([listAssets(), tripoBalance()]);
  const used = isHosted() ? assets.reduce((n, a) => n + (a.fileSize ?? 0), 0) : await storageUsage();
  const body: AppConfig = {
    engines: engineList(),
    defaultEngine: defaultEngine(),
    storage: { used, count: assets.filter((a) => a.status === "ready").length },
    balance,
    features: { blend: blendSupported() || remoteBlendReady(), blendRemote: !blendSupported() && remoteBlendReady(), hosted: isHosted(), auth: !!process.env.APP_PASSWORD },
  };
  return NextResponse.json(body);
}
