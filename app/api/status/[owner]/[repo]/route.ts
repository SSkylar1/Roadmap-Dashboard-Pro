import { NextRequest, NextResponse } from "next/server";

import { STANDALONE_MODE } from "@/lib/config";
import { getFileRaw } from "@/lib/github";
import { normalizeOwner, normalizeRepo } from "@/lib/manual-state";
import { projectAwarePath, normalizeProjectKey } from "@/lib/project-paths";
import { getLatestStandaloneStatusSnapshot } from "@/lib/standalone/status-snapshots";

export async function GET(
  req: NextRequest,
  { params }: { params: { owner: string; repo: string } },
) {
  try {
    const url = new URL(req.url);
    const branchRaw = url.searchParams.get("branch");
    const branch = branchRaw ? branchRaw.trim() || undefined : undefined;
    const projectKey = normalizeProjectKey(url.searchParams.get("project"));
    const token = req.headers.get("x-github-pat")?.trim() || undefined;

    if (STANDALONE_MODE) {
      const ownerKey = normalizeOwner(params.owner);
      const repoKey = normalizeRepo(params.repo);
      if (!ownerKey || !repoKey) {
        return NextResponse.json({ error: "invalid_repo" }, { status: 400 });
      }

      const workspaceId = `${ownerKey}/${repoKey}`;
      const snapshot = getLatestStandaloneStatusSnapshot(
        workspaceId,
        projectKey ?? null,
        branch ?? null,
      );

      if (!snapshot) {
        return NextResponse.json({ error: "not_found" }, { status: 404 });
      }

      const payload = snapshot.payload;
      if (!payload || typeof payload !== "object") {
        return NextResponse.json({ error: "invalid_snapshot" }, { status: 500 });
      }

      const statusPayload = { ...(payload as Record<string, any>) };
      if (projectKey && !statusPayload.project) {
        statusPayload.project = projectKey;
      }

      return NextResponse.json({
        source: "standalone",
        snapshot: statusPayload,
        meta: {
          id: snapshot.id,
          workspace_id: snapshot.workspace_id,
          project_id: snapshot.project_id,
          branch: snapshot.branch,
          created_at: snapshot.created_at,
        },
      });
    }

    const raw = await getFileRaw(
      params.owner,
      params.repo,
      projectAwarePath("docs/roadmap-status.json", projectKey),
      branch,
      token,
    ).catch(() => null);
    if (!raw) return NextResponse.json({ error: "not_found" }, { status: 404 });
    const parsed = JSON.parse(raw);
    if (projectKey) {
      parsed.project = parsed.project ?? projectKey;
    }
    return NextResponse.json(parsed);
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
