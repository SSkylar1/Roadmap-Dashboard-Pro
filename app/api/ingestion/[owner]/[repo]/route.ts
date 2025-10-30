import { NextRequest, NextResponse } from "next/server";

import { getIngestionState } from "@/lib/ingestion-state";
import { normalizeProjectKey } from "@/lib/project-paths";

export async function GET(
  req: NextRequest,
  { params }: { params: { owner: string; repo: string } },
) {
  try {
    const url = new URL(req.url);
    const projectParam = url.searchParams.get("project");
    const project = normalizeProjectKey(projectParam ?? undefined) ?? null;
    const state = await getIngestionState(params.owner, params.repo, project);
    if (!state) {
      return NextResponse.json({ ok: false, error: "invalid_repo" }, { status: 400 });
    }
    return NextResponse.json({ ok: true, owner: params.owner, repo: params.repo, project, state });
  } catch (error) {
    return NextResponse.json({ ok: false, error: String(error) }, { status: 500 });
  }
}
