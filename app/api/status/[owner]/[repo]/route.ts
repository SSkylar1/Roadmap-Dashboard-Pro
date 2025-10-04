import { NextRequest, NextResponse } from "next/server";
import { getFileRaw } from "@/lib/github";
import { projectAwarePath, normalizeProjectKey } from "@/lib/project-paths";

export async function GET(req: NextRequest, { params }: { params: { owner: string; repo: string } }) {
  try {
    const url = new URL(req.url);
    const branch = url.searchParams.get("branch") || undefined;
    const projectKey = normalizeProjectKey(url.searchParams.get("project"));
    const token = req.headers.get("x-github-pat")?.trim() || undefined;
    const raw = await getFileRaw(
      params.owner,
      params.repo,
      projectAwarePath("docs/roadmap-status.json", projectKey),
      branch,
      token,
    ).catch(() => null);
    if (!raw) return NextResponse.json({ error:"not_found" }, { status:404 });
    const parsed = JSON.parse(raw);
    if (projectKey) {
      parsed.project = parsed.project ?? projectKey;
    }
    return NextResponse.json(parsed);
  } catch (e:any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status:500 });
  }
}
