import { NextRequest, NextResponse } from "next/server";
import { getFileRaw } from "@/lib/github";

export async function GET(req: NextRequest, { params }: { params: { owner: string; repo: string } }) {
  try {
    const url = new URL(req.url);
    const branch = url.searchParams.get("branch") || undefined;
    const token = req.headers.get("x-github-pat")?.trim() || undefined;
    const raw = await getFileRaw(params.owner, params.repo, "docs/roadmap-status.json", branch, token).catch(() => null);
    if (!raw) return NextResponse.json({ error:"not_found" }, { status:404 });
    return NextResponse.json(JSON.parse(raw));
  } catch (e:any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status:500 });
  }
}
