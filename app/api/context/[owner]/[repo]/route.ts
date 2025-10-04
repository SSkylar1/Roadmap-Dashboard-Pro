import { NextRequest, NextResponse } from "next/server";

import { getFileRaw } from "@/lib/github";
import { describeProjectFile, normalizeProjectKey, projectAwarePath } from "@/lib/project-paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteParams = { params: { owner: string; repo: string } };

type ContextPackFile = {
  path: string;
  optional?: boolean;
};

const CONTEXT_FILES: ContextPackFile[] = [
  { path: "docs/roadmap.yml" },
  { path: "docs/roadmap-status.json" },
  { path: "docs/tech-stack.yml" },
  { path: "docs/backlog-discovered.yml" },
  { path: "docs/summary.txt" },
  { path: "docs/gtm-plan.md", optional: true },
];

function normalizeBranch(value: string | null): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

export async function GET(req: NextRequest, { params }: RouteParams) {
  const { owner, repo } = params;
  const url = new URL(req.url);
  const branch = normalizeBranch(url.searchParams.get("branch"));
  const projectKey = normalizeProjectKey(url.searchParams.get("project"));

  try {
    const token = req.headers.get("x-github-pat")?.trim() || undefined;

    const entries = await Promise.all(
      CONTEXT_FILES.map(async (file) => ({
        path: describeProjectFile(file.path, projectKey),
        optional: file.optional ?? false,
        content: await getFileRaw(owner, repo, projectAwarePath(file.path, projectKey), branch, token),
      })),
    );

    const missing = entries
      .filter((entry) => !entry.optional && entry.content === null)
      .map((entry) => entry.path);

    if (missing.length > 0) {
      return NextResponse.json(
        {
          error: "missing_required_files",
          missing,
        },
        { status: 404 },
      );
    }

    const files: Record<string, string> = {};
    for (const entry of entries) {
      if (typeof entry.content === "string") {
        files[entry.path] = entry.content;
      }
    }

    const payload = {
      generated_at: new Date().toISOString(),
      repo: {
        owner,
        name: repo,
        branch: branch ?? "HEAD",
        project: projectKey || undefined,
      },
      files,
    };

    return NextResponse.json(payload);
  } catch (error: any) {
    return NextResponse.json(
      {
        error: error?.message ?? "Failed to build context pack",
      },
      { status: 500 },
    );
  }
}
