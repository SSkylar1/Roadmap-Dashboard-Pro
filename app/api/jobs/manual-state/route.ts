import { NextRequest, NextResponse } from "next/server";

import { getIngestionState, markManualStateUpdated } from "@/lib/ingestion-state";
import { triggerRun } from "@/lib/run-trigger";

function authorize(req: NextRequest): boolean {
  const secret = process.env.MANUAL_STATE_JOB_SECRET;
  if (!secret) {
    return true;
  }
  const provided = req.headers.get("x-job-secret") ?? req.headers.get("authorization");
  if (!provided) return false;
  if (provided === secret) return true;
  if (provided.startsWith("Bearer ")) {
    return provided.slice("Bearer ".length) === secret;
  }
  return false;
}

function pickRecord(payload: any): any {
  if (payload && typeof payload === "object") {
    if (payload.record && typeof payload.record === "object") return payload.record;
    if (payload.new && typeof payload.new === "object") return payload.new;
    if (payload.row && typeof payload.row === "object") return payload.row;
  }
  return null;
}

function pickOldRecord(payload: any): any {
  if (payload && typeof payload === "object") {
    if (payload.old_record && typeof payload.old_record === "object") return payload.old_record;
    if (payload.old && typeof payload.old === "object") return payload.old;
    if (payload.previous && typeof payload.previous === "object") return payload.previous;
  }
  return null;
}

function extractTimestamp(record: any): string | null {
  if (record && typeof record === "object") {
    if (typeof record.updated_at === "string") return record.updated_at;
    if (typeof record.inserted_at === "string") return record.inserted_at;
  }
  return null;
}

function normalizeProject(projectId: unknown): string | null {
  if (typeof projectId !== "string") return null;
  const trimmed = projectId.trim();
  if (!trimmed) return null;
  return trimmed;
}

function compareTimestamps(a: string | null | undefined, b: string | null | undefined): number {
  if (!a && !b) return 0;
  if (!a) return -1;
  if (!b) return 1;
  const aTime = Date.parse(a);
  const bTime = Date.parse(b);
  if (Number.isNaN(aTime) && Number.isNaN(bTime)) return 0;
  if (Number.isNaN(aTime)) return -1;
  if (Number.isNaN(bTime)) return 1;
  if (aTime === bTime) return 0;
  return aTime > bTime ? 1 : -1;
}

export async function POST(req: NextRequest) {
  if (!authorize(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let payload: any;
  try {
    payload = await req.json();
  } catch (error) {
    return NextResponse.json({ ok: false, error: "invalid_json", detail: String(error) }, { status: 400 });
  }

  const record = pickRecord(payload) ?? pickOldRecord(payload);
  if (!record) {
    return NextResponse.json({ ok: true, skipped: true, reason: "no_record" });
  }

  const owner = typeof record.owner === "string" ? record.owner.trim() : "";
  const repo = typeof record.repo === "string" ? record.repo.trim() : "";
  if (!owner || !repo) {
    return NextResponse.json({ ok: true, skipped: true, reason: "missing_repo" });
  }
  const project = normalizeProject(record.project_id ?? record.project);
  const updatedAt = extractTimestamp(record) ?? new Date().toISOString();

  try {
    const before = await getIngestionState(owner, repo, project);
    await markManualStateUpdated(owner, repo, project, updatedAt);

    const alreadyHandled = before?.last_run_manual_state_at === updatedAt;
    const needsRun = !alreadyHandled && compareTimestamps(updatedAt, before?.last_run_manual_state_at) > 0;
    if (!needsRun) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: alreadyHandled ? "already_processed" : "stale_update",
        owner,
        repo,
        project,
      });
    }

    const trigger = await triggerRun(req, {
      owner,
      repo,
      project,
      commitSha: before?.last_commit_sha ?? before?.last_run_sha ?? null,
      manualStateUpdatedAt: updatedAt,
      runAt: updatedAt,
    });

    return NextResponse.json({
      ok: trigger.ok,
      status: trigger.status,
      response: trigger.body,
      owner,
      repo,
      project,
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: String(error) }, { status: 500 });
  }
}
