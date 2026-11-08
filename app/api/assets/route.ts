import { NextResponse } from "next/server";
import { listAssets } from "@/lib/server/storage";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await listAssets());
}
