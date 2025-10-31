import { NextRequest, NextResponse } from "next/server";

import { STANDALONE_MODE } from "@/lib/config";
import { deletePath } from "@/lib/github";
import { saveManualState } from "@/lib/manual-store";
import { normalizeProjectKey, projectAwarePath } from "@/lib/project-paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REMOVAL_PATHS = [
  "docs/roadmap.yml",
  "docs/roadmap-status.json",
  "docs/roadmap/roadmap-status.json",
  "docs/project-plan.md",
  "docs/roadmap/project-plan.md",
  "docs/discover.yml",
  "docs/backlog-discovered.yml",
  "docs/summary.txt",
  "docs/gtm-plan.md",
  "docs/infra-facts.md",
  "docs/tech-stack.yml",
  "docs/idea-log.md",
  ".github/workflows/roadmap.yml",
  "docs/roadmap",
] as const;

type RouteContext = { params: { owner: string; repo: string } };

type DeletePayload = {
  project?: string | null;
  branch?: string | null;
};

function buildMessage(project: string | null, path: string): string {
  const base = project
    ? `chore(${project}): remove roadmap artifacts [skip ci]`
    : "chore(roadmap): remove roadmap artifacts [skip ci]";
  return `${base} (${path})`;
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  if (STANDALONE_MODE) {
    return NextResponse.json({ ok: false, error: "unsupported_in_standalone" }, { status: 400 });
  }

  const token = req.headers.get("x-github-pat")?.trim();
  if (!token) {
    return NextResponse.json({ ok: false, error: "missing_github_pat" }, { status: 401 });
  }

  let payload: DeletePayload = {};
  try {
    payload = (await req.json()) as DeletePayload;
  } catch {
    // ignore malformed JSON; handled below
  }

  if (!Object.prototype.hasOwnProperty.call(payload, "project")) {
    return NextResponse.json({ ok: false, error: "missing_project" }, { status: 400 });
  }

  const projectRaw = payload.project;
  let projectKey: string | null;
  if (projectRaw === null) {
    projectKey = null;
  } else if (typeof projectRaw === "string") {
    const normalized = normalizeProjectKey(projectRaw);
    if (!normalized) {
      return NextResponse.json({ ok: false, error: "invalid_project" }, { status: 400 });
    }
    projectKey = normalized;
  } else {
    return NextResponse.json({ ok: false, error: "invalid_project" }, { status: 400 });
  }

  const branch = typeof payload?.branch === "string" && payload.branch.trim() ? payload.branch.trim() : undefined;

  const targets = new Set<string>();
  for (const basePath of REMOVAL_PATHS) {
    targets.add(projectAwarePath(basePath, projectKey));
  }
  if (projectKey) {
    targets.add(`docs/projects/${projectKey}`);
  }

  const deleted = new Set<string>();
  const missing = new Set<string>();
  const errors: Array<{ path: string; error: string }> = [];

  for (const target of targets) {
    try {
      const result = await deletePath(params.owner, params.repo, target, {
        token,
        branch,
        message: (path) => buildMessage(projectKey, path),
      });
      for (const path of result.deleted) deleted.add(path);
      for (const path of result.missing) missing.add(path);
    } catch (error) {
      errors.push({ path: target, error: error instanceof Error ? error.message : String(error) });
    }
  }

  let manualCleared = false;
  let manualStorage: string | null = null;
  let manualUpdatedAt: string | null = null;
  try {
    const manualResult = await saveManualState(params.owner, params.repo, projectKey, {});
    manualCleared = Object.keys(manualResult.state ?? {}).length === 0;
    manualStorage = manualResult.storage ?? null;
    manualUpdatedAt = manualResult.updated_at ?? null;
  } catch (error) {
    errors.push({ path: "manual_state", error: error instanceof Error ? error.message : String(error) });
  }

  const responseBody = {
    ok: errors.length === 0,
    owner: params.owner,
    repo: params.repo,
    project: projectKey,
    branch: branch ?? null,
    deleted: Array.from(deleted).sort(),
    missing: Array.from(missing).sort(),
    manualCleared,
    manualStorage,
    manualUpdatedAt,
    errors,
  };

  const status = errors.length === 0 ? 200 : 207;
  return NextResponse.json(responseBody, { status });
}
