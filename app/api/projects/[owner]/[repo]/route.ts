import { NextRequest, NextResponse } from "next/server";

import { STANDALONE_MODE } from "@/lib/config";
import { listRepoTreePaths } from "@/lib/github";
import { deriveStandaloneWorkspaceId } from "@/lib/standalone/roadmaps-store";

const PROJECT_PREFIX = "docs/projects/";

function deriveProjectSlugs(paths: string[]): string[] {
  if (!Array.isArray(paths)) return [];
  const slugs = new Set<string>();
  for (const path of paths) {
    if (typeof path !== "string") continue;
    if (!path.startsWith(PROJECT_PREFIX)) continue;
    const remainder = path.slice(PROJECT_PREFIX.length);
    const parts = remainder.split("/");
    const slug = parts[0]?.trim();
    if (!slug) continue;
    slugs.add(slug);
  }
  return Array.from(slugs).sort((a, b) => a.localeCompare(b));
}

export async function GET(req: NextRequest, { params }: { params: { owner: string; repo: string } }) {
  try {
    const url = new URL(req.url);
    const branch = url.searchParams.get("branch")?.trim();
    const token = req.headers.get("x-github-pat")?.trim() || undefined;
    const ref = branch && branch.length > 0 ? branch : undefined;
    if (STANDALONE_MODE) {
      const workspaceId = deriveStandaloneWorkspaceId(params.owner, params.repo);
      const projects: Array<{ slug: string }> = [];
      const headers: Record<string, string> = { "cache-control": "no-store" };
      if (workspaceId) {
        headers["x-standalone-workspace"] = workspaceId;
      }
      return NextResponse.json({ projects }, { headers });
    }

    const treePaths = await listRepoTreePaths(params.owner, params.repo, ref, token);
    const projects = deriveProjectSlugs(treePaths).map((slug) => ({ slug }));
    return NextResponse.json({ projects }, { headers: { "cache-control": "no-store" } });
  } catch (error: any) {
    return NextResponse.json({ error: String(error?.message || error) }, { status: 500 });
  }
}

