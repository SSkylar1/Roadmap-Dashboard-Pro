// app/api/run/route.ts
// Node runtime + no caching to ensure commits always reflect current state
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import yaml from "js-yaml";
import { getFileRaw, putFile } from "@/lib/github";
import { describeProjectFile, normalizeProjectKey, projectAwarePath } from "@/lib/project-paths";

type Check = {
  type: "files_exist" | "http_ok" | "sql_exists";
  globs?: string[];
  files?: string[];
  detail?: string;
  url?: string;
  must_match?: string[];
  query?: string;
};

type ProbeHeaders = Record<string, string>;

function parseProbeHeaders(source: unknown): ProbeHeaders {
  if (!source) return {};

  if (typeof source === "object" && !Array.isArray(source)) {
    const entries = Object.entries(source as Record<string, unknown>)
      .map(([key, value]) => [key.trim(), typeof value === "string" ? value.trim() : ""] as const)
      .filter(([key, value]) => key.length > 0 && value.length > 0);
    return Object.fromEntries(entries) as ProbeHeaders;
  }

  if (typeof source !== "string") return {};

  const trimmed = source.trim();
  if (!trimmed) return {};

  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parseProbeHeaders(parsed as Record<string, unknown>);
    }
  } catch {
    // fall through to newline parsing when JSON fails
  }

  const headers: ProbeHeaders = {};
  for (const line of trimmed.split(/\r?\n|,/)) {
    const text = line.trim();
    if (!text) continue;
    const separatorIndex = text.indexOf(":");
    if (separatorIndex === -1) continue;
    const key = text.slice(0, separatorIndex).trim();
    const value = text.slice(separatorIndex + 1).trim();
    if (!key || !value) continue;
    headers[key] = value;
  }
  return headers;
}

const ENV_PROBE_HEADERS: ProbeHeaders = parseProbeHeaders(process.env.READ_ONLY_CHECKS_HEADERS);

type RoadmapItem = {
  id?: string;
  name?: string;
  checks?: Check[];
  manual?: boolean;
  done?: boolean;
  note?: string;
  manualKey?: string;
};

type RoadmapWeek = { id?: string; title?: string; items?: RoadmapItem[] };

type RoadmapMilestone = {
  week?: string;
  title?: string;
  tasks?: unknown[];
};

type RoadmapPhase = {
  phase?: string;
  milestones?: RoadmapMilestone[];
};

function slugify(value: string, fallback: string) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) return fallback;
  const slug = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return slug || fallback;
}

function extractTaskName(input: unknown): string | undefined {
  if (typeof input === "string") return input.trim();
  if (input && typeof input === "object") {
    const record = input as Record<string, unknown>;
    const candidate = record.task || record.title || record.name;
    if (typeof candidate === "string") return candidate.trim();
  }
  return undefined;
}

function extractPhaseWeeks(roadmap: unknown): RoadmapWeek[] {
  if (!Array.isArray(roadmap)) return [];

  const weeks: RoadmapWeek[] = [];
  (roadmap as RoadmapPhase[]).forEach((phase, phaseIndex) => {
    const phaseLabel =
      typeof phase?.phase === "string" && phase.phase.trim()
        ? phase.phase.trim()
        : `Phase ${phaseIndex + 1}`;
    const milestones = Array.isArray(phase?.milestones) ? phase.milestones : [];
    milestones.forEach((milestone: RoadmapMilestone, milestoneIndex) => {
      const tasks = Array.isArray(milestone?.tasks) ? milestone.tasks : [];
      const items = tasks
        .map((task: unknown, taskIndex) => {
          const name = extractTaskName(task);
          if (!name) return null;
          const id = slugify(`${phaseLabel}-${name}`, `task-${phaseIndex + 1}-${milestoneIndex + 1}-${taskIndex + 1}`);
          return {
            id,
            name,
            checks: [] as Check[],
            manual: true,
            done: false,
          } satisfies RoadmapItem;
        })
        .filter((value): value is RoadmapItem => Boolean(value));

      const weekLabel = typeof milestone?.week === "string" ? milestone.week.trim() : "";
      const milestoneTitle = typeof milestone?.title === "string" ? milestone.title.trim() : "";
      const descriptor = milestoneTitle || (weekLabel ? `Weeks ${weekLabel}` : "");
      const title = descriptor ? `${phaseLabel} — ${descriptor}` : phaseLabel;
      const weekIdSource = weekLabel || milestoneTitle || `${phaseIndex + 1}-${milestoneIndex + 1}`;
      const id = slugify(`${phaseLabel}-${weekIdSource}`, `week-${phaseIndex + 1}-${milestoneIndex + 1}`);

      weeks.push({
        id,
        title,
        items,
      });
    });
  });

  return weeks;
}

function extractWeeks(raw: any): RoadmapWeek[] {
  const directWeeks = Array.isArray(raw?.weeks) ? raw.weeks : [];
  if (directWeeks.length > 0) return directWeeks as RoadmapWeek[];

  if (Array.isArray(raw?.roadmap)) {
    const derived = extractPhaseWeeks(raw.roadmap);
    if (derived.length > 0) return derived;
  }

  if (Array.isArray(raw?.phases)) {
    const derived = extractPhaseWeeks(raw.phases);
    if (derived.length > 0) return derived;
  }

  return [];
}

function normalizeFileList(check: Check) {
  const collected: string[] = [];
  if (Array.isArray(check.globs)) collected.push(...check.globs.map((value) => String(value).trim()).filter(Boolean));
  if (Array.isArray(check.files)) collected.push(...check.files.map((value) => String(value).trim()).filter(Boolean));
  if (typeof check.detail === "string") {
    const extras = check.detail
      .split(/[\n,]+/)
      .map((value) => value.trim())
      .filter(Boolean);
    collected.push(...extras);
  }
  return Array.from(new Set(collected));
}

async function files_exist(owner: string, repo: string, check: Check, ref?: string) {
  const paths = normalizeFileList(check);
  if (paths.length === 0) {
    return { ok: false, error: "no files provided", files: [], missing: [] as string[] };
  }

  const missing: string[] = [];
  for (const p of paths) {
    // eslint-disable-next-line no-await-in-loop
    const raw = await getFileRaw(owner, repo, p, ref).catch(() => null);
    if (raw === null) missing.push(p);
  }

  return { ok: missing.length === 0, files: paths, missing };
}

async function http_ok(url: string, must_match: string[] = []) {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) return { ok: false, code: r.status };
  const t = await r.text();
  const ok = must_match.every((m) => t.includes(m));
  return { ok, code: r.status };
}

async function sql_exists(probeUrl: string, query: string, headers: ProbeHeaders) {
  const r = await fetch(probeUrl, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ queries: [query] }),
  });
  if (!r.ok) return { ok: false, code: r.status };
  const j = await r.json();
  const res = Array.isArray(j.results) ? j.results[0] : null;
  return { ok: !!res?.ok };
}

export async function POST(req: NextRequest) {
  try {
    const payload = await req.json();
    const owner = typeof payload?.owner === "string" ? payload.owner.trim() : "";
    const repo = typeof payload?.repo === "string" ? payload.repo.trim() : "";
    const branch =
      typeof payload?.branch === "string" && payload.branch.trim() ? payload.branch.trim() : "main";
    const probeUrl = typeof payload?.probeUrl === "string" ? payload.probeUrl : undefined;
    const rawRequestProbeHeaders =
      req.headers.get("x-supabase-headers") ??
      req.headers.get("x-probe-headers") ??
      req.headers.get("x-discovery-headers");
    const requestProbeHeaders = parseProbeHeaders(rawRequestProbeHeaders);

    const payloadProbeHeadersRaw =
      (payload &&
        (payload.probeHeaders ??
          payload.probe_headers ??
          payload.supabaseHeaders ??
          payload.supabase_headers ??
          payload.headers)) ||
      undefined;
    const overrideProbeHeaders = parseProbeHeaders(payloadProbeHeadersRaw);
    const combinedProbeHeaders: ProbeHeaders = {
      ...ENV_PROBE_HEADERS,
      ...requestProbeHeaders,
      ...overrideProbeHeaders,
    };
    const projectKey = normalizeProjectKey(payload?.project);
    const token = req.headers.get("x-github-pat")?.trim() || undefined;
    if (!owner || !repo) {
      return NextResponse.json({ error: "missing owner/repo" }, { status: 400 });
    }

    // Load roadmap spec
    const roadmapPath = projectAwarePath("docs/roadmap.yml", projectKey);
    const rmRaw = await getFileRaw(owner, repo, roadmapPath, branch, token);
    if (rmRaw === null) {
      return NextResponse.json({ error: `${describeProjectFile("docs/roadmap.yml", projectKey)} missing` }, { status: 404 });
    }
    const rm: any = yaml.load(rmRaw);

    // Execute checks
    const weeks = extractWeeks(rm);

    const status: any = {
      generated_at: new Date().toISOString(),
      owner,
      repo,
      branch,
      project: projectKey || undefined,
      weeks: [] as any[],
    };
    for (const w of weeks) {
      const W: any = { id: w.id, title: w.title, items: [] as any[] };
      for (const it of w.items ?? []) {
        let passed = true;
        let hadChecks = false;
        const results: any[] = [];
        for (const c of (it.checks as Check[]) ?? []) {
          hadChecks = true;
          let r;
          if (c.type === "files_exist") r = await files_exist(owner, repo, c, branch);
          else if (c.type === "http_ok") r = await http_ok(c.url!, c.must_match || []);
          else if (c.type === "sql_exists") {
            if (!probeUrl) r = { ok: false, error: "probeUrl not provided" };
            else r = await sql_exists(probeUrl, c.query!, combinedProbeHeaders);
          } else r = { ok: false, error: "unknown check" };
          results.push({ ...c, ...r });
          if (!r.ok) passed = false;
        }
        const manual = it.manual === true;
        const note = typeof it.note === "string" ? it.note : undefined;
        const manualKey = typeof it.manualKey === "string" ? it.manualKey : undefined;
        const itemDone = hadChecks ? passed : it.done === true;
        const item: any = { id: it.id, name: it.name, done: itemDone, results };
        if (manual) item.manual = true;
        if (note) item.note = note;
        if (manualKey) item.manualKey = manualKey;
        W.items.push(item);
      }
      status.weeks.push(W);
    }

    // Commit artifacts (write both root docs/* and legacy docs/roadmap/*)
    const pretty = JSON.stringify(status, null, 2);
    const wrote: string[] = [];

    async function safePut(p: string, content: string, msg: string) {
      try {
        await putFile(owner, repo, p, content, branch, msg, token);
        wrote.push(p);
      } catch (e: any) {
        wrote.push(`${p} (FAILED: ${e?.message || e})`);
      }
    }

    // 1) machine artifact(s)
    const statusMessage = projectKey
      ? `chore(${projectKey}): update status [skip ci]`
      : "chore(roadmap): update status [skip ci]";
    await safePut(projectAwarePath("docs/roadmap-status.json", projectKey), pretty, statusMessage);
    await safePut(projectAwarePath("docs/roadmap/roadmap-status.json", projectKey), pretty, statusMessage);

    // 2) human-readable plan
    let plan = `# Project Plan\nGenerated: ${status.generated_at}\n\n`;
    for (const w of status.weeks) {
      plan += `## ${w.title}\n\n`;
      for (const it of w.items) plan += `${it.done ? "✅" : "❌"} **${it.name}** (${it.id})\n`;
      plan += `\n`;
    }
    const planMessage = projectKey
      ? `chore(${projectKey}): update plan [skip ci]`
      : "chore(roadmap): update plan [skip ci]";
    await safePut(projectAwarePath("docs/project-plan.md", projectKey), plan, planMessage);
    await safePut(projectAwarePath("docs/roadmap/project-plan.md", projectKey), plan, planMessage);

    return NextResponse.json({ ok: true, wrote }, { headers: { "cache-control": "no-store" } });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
