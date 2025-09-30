export const runtime = "nodejs";
export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";

export async function GET() {
  const v = process.env.GITHUB_TOKEN || "";
  return NextResponse.json(
    { hasGITHUB_TOKEN: !!v, sample: v ? `${v.slice(0,4)}***(${v.length})` : "" },
    { headers: { "cache-control": "no-store" } }
  );
}
