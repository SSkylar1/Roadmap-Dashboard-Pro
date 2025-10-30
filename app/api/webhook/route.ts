import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";

import { getIngestionState, recordCommitMetadata } from "@/lib/ingestion-state";
import { inferProjectsFromPaths } from "@/lib/project-paths";
import { triggerRun } from "@/lib/run-trigger";

function verifySignature(signature: string | null, body: string, secret: string): boolean {
  if (!signature || !secret) return false;
  const expected = `sha256=${crypto.createHmac("sha256", secret).update(body).digest("hex")}`;
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

function uniquePaths(paths: unknown): string[] {
  if (!Array.isArray(paths)) return [];
  const set = new Set<string>();
  for (const entry of paths) {
    if (typeof entry !== "string") continue;
    const trimmed = entry.trim();
    if (!trimmed) continue;
    set.add(trimmed);
  }
  return Array.from(set);
}

function collectPushPaths(payload: any): string[] {
  const set = new Set<string>();
  const commits = Array.isArray(payload?.commits) ? payload.commits : [];
  for (const commit of commits) {
    uniquePaths(commit?.added).forEach((path) => set.add(path));
    uniquePaths(commit?.removed).forEach((path) => set.add(path));
    uniquePaths(commit?.modified).forEach((path) => set.add(path));
  }
  const head = payload?.head_commit;
  if (head && typeof head === "object") {
    uniquePaths(head?.added).forEach((path) => set.add(path));
    uniquePaths(head?.removed).forEach((path) => set.add(path));
    uniquePaths(head?.modified).forEach((path) => set.add(path));
  }
  return Array.from(set);
}

type RunPlan = {
  owner: string;
  repo: string;
  branch: string | null;
  project: string | null;
  commitSha: string | null;
  commitMessage: string | null;
  commitAuthor: string | null;
  commitUrl: string | null;
  commitAt: string | null;
  changedPaths: string[];
  reason: string;
};

function resolveRepoOwner(payload: any): string | null {
  const repoOwner = payload?.repository?.owner ?? payload?.repository?.organization;
  if (repoOwner && typeof repoOwner === "object") {
    if (typeof repoOwner.login === "string" && repoOwner.login.trim()) return repoOwner.login.trim();
    if (typeof repoOwner.name === "string" && repoOwner.name.trim()) return repoOwner.name.trim();
  }
  const fullName = typeof payload?.repository?.full_name === "string" ? payload.repository.full_name : null;
  if (fullName && fullName.includes("/")) {
    return fullName.split("/")[0]!.trim() || null;
  }
  return null;
}

function resolveRepoName(payload: any): string | null {
  if (typeof payload?.repository?.name === "string" && payload.repository.name.trim()) {
    return payload.repository.name.trim();
  }
  const fullName = typeof payload?.repository?.full_name === "string" ? payload.repository.full_name : null;
  if (fullName && fullName.includes("/")) {
    return fullName.split("/")[1]!.trim() || null;
  }
  return null;
}

function planRunsForPush(payload: any): RunPlan[] {
  if (!payload || typeof payload !== "object") return [];
  if (payload.deleted === true) return [];
  const owner = resolveRepoOwner(payload);
  const repo = resolveRepoName(payload);
  if (!owner || !repo) return [];
  const ref = typeof payload?.ref === "string" ? payload.ref : "";
  const branch = ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : null;
  const head = payload?.head_commit;
  const commitSha =
    (typeof head?.id === "string" && head.id.trim()) ||
    (typeof payload?.after === "string" && payload.after.trim()) ||
    null;
  const commitMessage = typeof head?.message === "string" ? head.message : null;
  const commitAuthor =
    typeof head?.author?.name === "string"
      ? head.author.name
      : typeof head?.author?.username === "string"
        ? head.author.username
        : null;
  const commitUrl = typeof head?.url === "string" ? head.url : null;
  const commitAt = typeof head?.timestamp === "string" ? head.timestamp : null;
  const changedPaths = collectPushPaths(payload);
  const projects = inferProjectsFromPaths(changedPaths);
  const targets = projects.length > 0 ? projects : [null];
  return targets.map((project) => ({
    owner,
    repo,
    branch,
    project,
    commitSha,
    commitMessage,
    commitAuthor,
    commitUrl,
    commitAt,
    changedPaths,
    reason: "push",
  }));
}

async function listPullRequestFiles(owner: string, repo: string, number: number): Promise<string[]> {
  if (!owner || !repo || !Number.isFinite(number)) return [];
  const token = process.env.GITHUB_WEBHOOK_PAT || process.env.GITHUB_TOKEN || undefined;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "roadmap-dashboard-pro",
  };
  if (token) {
    headers.Authorization = `token ${token}`;
  }

  const paths = new Set<string>();
  const maxPages = 10;
  for (let page = 1; page <= maxPages; page += 1) {
    const url = `https://api.github.com/repos/${owner}/${repo}/pulls/${number}/files?per_page=100&page=${page}`;
    const response = await fetch(url, { headers, cache: "no-store" });
    if (response.status === 404) break;
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Failed to list PR files (${response.status}): ${text}`);
    }
    const chunk = (await response.json()) as Array<{ filename?: string } | null>;
    if (!Array.isArray(chunk) || chunk.length === 0) {
      break;
    }
    for (const entry of chunk) {
      const filename = typeof entry?.filename === "string" ? entry.filename.trim() : "";
      if (!filename) continue;
      paths.add(filename);
    }
    if (chunk.length < 100) {
      break;
    }
  }

  return Array.from(paths);
}

async function planRunsForPullRequest(payload: any): Promise<RunPlan[]> {
  if (!payload || typeof payload !== "object") return [];
  const action = typeof payload?.action === "string" ? payload.action : "";
  const relevantActions = new Set([
    "opened",
    "synchronize",
    "reopened",
    "ready_for_review",
    "edited",
  ]);
  if (!relevantActions.has(action)) return [];

  const pr = payload?.pull_request;
  if (!pr || typeof pr !== "object") return [];
  const baseRepo = pr?.base?.repo ?? payload?.repository;
  const owner = resolveRepoOwner({ repository: baseRepo }) ?? null;
  const repo = resolveRepoName({ repository: baseRepo }) ?? null;
  if (!owner || !repo) return [];

  const branch = typeof pr?.head?.ref === "string" ? pr.head.ref : null;
  const commitSha = typeof pr?.head?.sha === "string" ? pr.head.sha : null;
  const commitMessage = typeof pr?.title === "string" ? pr.title : null;
  const commitAuthor = typeof pr?.user?.login === "string" ? pr.user.login : null;
  const commitUrl =
    typeof pr?.html_url === "string"
      ? pr.html_url
      : typeof pr?._links?.html?.href === "string"
        ? pr._links.html.href
        : null;
  const commitAt = typeof pr?.updated_at === "string" ? pr.updated_at : typeof pr?.created_at === "string" ? pr.created_at : null;
  const number = Number(pr?.number);
  let changedPaths: string[] = [];
  try {
    changedPaths = await listPullRequestFiles(owner, repo, number);
  } catch (error) {
    console.error("Failed to load pull request files", error);
    changedPaths = [];
  }
  const projects = inferProjectsFromPaths(changedPaths);
  const targets = projects.length > 0 ? projects : [null];
  return targets.map((project) => ({
    owner,
    repo,
    branch,
    project,
    commitSha,
    commitMessage,
    commitAuthor,
    commitUrl,
    commitAt,
    changedPaths,
    reason: `pull_request:${action}`,
  }));
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const signature = req.headers.get("x-hub-signature-256");
  const secret = process.env.GITHUB_WEBHOOK_SECRET ?? "";
  if (!verifySignature(signature, raw, secret)) {
    return NextResponse.json({ ok: false, error: "invalid_signature" }, { status: 401 });
  }

  let payload: any = null;
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch (error) {
    return NextResponse.json({ ok: false, error: "invalid_json", detail: String(error) }, { status: 400 });
  }

  const event = req.headers.get("x-github-event") ?? "unknown";
  if (event === "ping") {
    return NextResponse.json({ ok: true, ping: true });
  }

  let plans: RunPlan[] = [];
  try {
    if (event === "push") {
      plans = planRunsForPush(payload);
    } else if (event === "pull_request") {
      plans = await planRunsForPullRequest(payload);
    } else {
      return NextResponse.json({ ok: true, ignored: event });
    }
  } catch (error) {
    return NextResponse.json({ ok: false, error: "plan_failed", detail: String(error) }, { status: 500 });
  }

  if (plans.length === 0) {
    return NextResponse.json({ ok: true, runs: [] });
  }

  const runs: Array<Record<string, unknown>> = [];
  const errors: Array<{ project: string | null; error: string }> = [];

  for (const plan of plans) {
    try {
      const stateBefore = await getIngestionState(plan.owner, plan.repo, plan.project);
      await recordCommitMetadata(plan.owner, plan.repo, plan.project, {
        sha: plan.commitSha,
        message: plan.commitMessage,
        author: plan.commitAuthor,
        url: plan.commitUrl,
        committed_at: plan.commitAt,
        paths: plan.changedPaths,
      });

      const alreadyProcessed = Boolean(plan.commitSha && stateBefore?.last_run_sha === plan.commitSha);
      if (alreadyProcessed) {
        runs.push({
          owner: plan.owner,
          repo: plan.repo,
          project: plan.project,
          branch: plan.branch,
          commit: plan.commitSha,
          skipped: true,
          reason: "already_processed",
        });
        continue;
      }

      const trigger = await triggerRun(req, {
        owner: plan.owner,
        repo: plan.repo,
        branch: plan.branch,
        project: plan.project,
        commitSha: plan.commitSha,
        manualStateUpdatedAt: stateBefore?.last_manual_state_at ?? null,
        changedPaths: plan.changedPaths,
        runAt: plan.commitAt ?? undefined,
      });

      runs.push({
        owner: plan.owner,
        repo: plan.repo,
        project: plan.project,
        branch: plan.branch,
        commit: plan.commitSha,
        status: trigger.status,
        ok: trigger.ok,
        response: trigger.body,
        reason: plan.reason,
      });
    } catch (error) {
      errors.push({ project: plan.project, error: String(error) });
    }
  }

  if (errors.length > 0) {
    return NextResponse.json({ ok: false, runs, errors }, { status: 500 });
  }

  return NextResponse.json({ ok: true, runs });
}
