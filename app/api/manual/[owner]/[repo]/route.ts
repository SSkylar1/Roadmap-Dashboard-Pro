import { NextRequest, NextResponse } from "next/server";

import { loadManualState, saveManualState } from "@/lib/manual-store";
import { sanitizeManualState } from "@/lib/manual-state";
import { normalizeProjectKey } from "@/lib/project-paths";

export async function GET(req: NextRequest, { params }: { params: { owner: string; repo: string } }) {
  try {
    const url = new URL(req.url);
    const projectParam = url.searchParams.get("project");
    const project = normalizeProjectKey(projectParam ?? undefined);
    const result = await loadManualState(params.owner, params.repo, project ?? null);
    return NextResponse.json(
      {
        available: result.available,
        state: result.state,
        updated_at: result.updated_at,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error: any) {
    const message = error?.message || "Failed to load manual state";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: { owner: string; repo: string } }) {
  try {
    const url = new URL(req.url);
    const projectParam = url.searchParams.get("project");
    const project = normalizeProjectKey(projectParam ?? undefined);
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "invalid payload" }, { status: 400 });
    }

    const state = sanitizeManualState((body as { state?: unknown }).state);
    const result = await saveManualState(params.owner, params.repo, project ?? null, state);
    return NextResponse.json(
      {
        available: result.available,
        state: result.state,
        updated_at: result.updated_at,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error: any) {
    const message = error?.message || "Failed to save manual state";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
