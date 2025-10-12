// app/api/run/route.ts
// Node runtime + no caching to ensure commits always reflect current state
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import yaml from "js-yaml";
import { getFileRaw, putFile } from "@/lib/github";
import { describeProjectFile, normalizeProjectKey, projectAwarePath } from "@/lib/project-paths";
import { loadManualState } from "@/lib/manual-store";
import type { ManualState } from "@/lib/manual-state";

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
  manualOverride?: { done?: boolean; note?: string };
};

type RoadmapWeek = { id?: string; title?: string; items?: RoadmapItem[] };

type RoadmapMilestone = {
  week?: string;
  title?: string;
  tasks?: unknown[];
};

function deriveWeekKey(week: any, index: number): string {
  const id = typeof week?.id === "string" ? week.id.trim() : "";
  if (id) return id;
  const title = typeof week?.title === "string" ? week.title.trim() : "";
  if (title) return title;
  return `week-${index + 1}`;
}

function deriveItemKey(item: any, index: number): string {
  const manualKey = typeof item?.manualKey === "string" ? item.manualKey.trim() : "";
  if (manualKey) return manualKey;
  const id = typeof item?.id === "string" ? item.id.trim() : "";
  if (id) return id;
  const name = typeof item?.name === "string" ? item.name.trim() : "";
  if (name) return name;
  return `item-${index + 1}`;
}

function applyManualAdjustments(weeks: any[], manualState: ManualState): any[] {
  if (!Array.isArray(weeks)) return weeks;
  if (!manualState || Object.keys(manualState).length === 0) return weeks;

  return weeks.map((week, weekIndex) => {
    const manualKey = deriveWeekKey(week, weekIndex);
    const manualWeek = manualState[manualKey];
    if (!manualWeek) return week;

    const baseItems: RoadmapItem[] = Array.isArray(week?.items) ? (week.items as RoadmapItem[]) : [];
    const removedKeys = new Set(manualWeek.removed ?? []);
    const filtered = baseItems
      .map((item: RoadmapItem, itemIndex: number) => ({ item, key: deriveItemKey(item, itemIndex) }))
      .filter(({ key }: { key: string }) => !removedKeys.has(key))
      .map(({ item, key }) => {
        const manualKeyValue = item?.manualKey ?? key;
        const override = (manualWeek.overrides ?? []).find((entry) => entry.key === manualKeyValue);
        const note = typeof override?.note === "string" ? override.note.trim() : "";
        const overridePayload =
          override && (override.done !== undefined || note)
            ? {
                ...(override.done !== undefined ? { done: override.done } : {}),
                ...(note ? { note } : {}),
              }
            : null;
        const next: RoadmapItem = {
          ...item,
          manualKey: manualKeyValue,
          ...(overridePayload ? { manualOverride: overridePayload } : {}),
        };
        if (typeof override?.done === "boolean") {
          next.done = override.done;
        }
        return next;
      });

    const manualItems = (manualWeek.added ?? []).map((manualItem) => ({
      id: manualItem.key,
      name: manualItem.name,
      note: manualItem.note,
      done: manualItem.done === true,
      manual: true,
      manualKey: manualItem.key,
      checks: [],
      results: [],
    }));

    return {
      ...week,
      items: [...filtered, ...manualItems],
    };
  });
}

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

const POSITIVE_STATUS_KEYWORDS = [
  "done",
  "complete",
  "completed",
  "finished",
  "shipped",
  "launched",
  "achieved",
  "met",
  "approved",
  "ready",
  "live",
  "delivered",
  "published",
  "released",
  "true",
  "yes",
];

const NEGATIVE_STATUS_KEYWORDS = [
  "todo",
  "backlog",
  "pending",
  "blocked",
  "not started",
  "tbd",
  "in progress",
  "wip",
  "no",
  "false",
  "open",
  "later",
  "skip",
  "hold",
  "paused",
  "stalled",
  "deferred",
];

function normalizeWhitespace(value: string) {
  return value
    .replace(/\s+/g, " ")
    .replace(/^[\s-]+/, "")
    .trim();
}

function stripBulletPrefix(value: string) {
  return value.replace(/^[-*+]\s+/, "").trim();
}

function parseCheckboxPrefix(value: string): { text: string; done?: boolean } {
  const match = value.match(/^\s*(?:[-*+]\s*)?\[(?<mark>[^\]])\]\s*(?<rest>.+)$/u);
  if (!match?.groups?.rest) {
    return { text: value.trim() };
  }

  const mark = match.groups.mark.trim().toLowerCase();
  const rest = match.groups.rest.trim();
  const truthy = ["x", "✔", "✓", "☑", "1", "done", "yes", "y"];
  const falsy = ["", " ", "-", "0"];
  let done: boolean | undefined;
  if (truthy.includes(mark)) done = true;
  else if (falsy.includes(mark)) done = false;

  return {
    text: rest,
    done,
  };
}

function stripEmojiIndicators(value: string): { text: string; done?: boolean } {
  let text = value.trim();
  let done: boolean | undefined;

  const leadingDone = text.match(/^(?:✅|☑️|✔️|✓)\s*(.+)$/u);
  if (leadingDone?.[1]) {
    text = leadingDone[1].trim();
    done = true;
  }

  const leadingTodo = text.match(/^(?:❌|⛔️|🚫|🛑)\s*(.+)$/u);
  if (leadingTodo?.[1]) {
    text = leadingTodo[1].trim();
    done = false;
  }

  const trailingDone = text.match(/^(.+?)(?:\s*(?:✅|☑️|✔️|✓))+$/u);
  if (trailingDone?.[1]) {
    text = trailingDone[1].trim();
    done = true;
  }

  const trailingTodo = text.match(/^(.+?)(?:\s*(?:❌|⛔️|🚫|🛑))+$/u);
  if (trailingTodo?.[1]) {
    text = trailingTodo[1].trim();
    done = false;
  }

  return { text, done };
}

function stripStatusSuffix(value: string): { text: string; done?: boolean } {
  let text = value;
  let done: boolean | undefined;

  const patterns = [
    { regex: /\b(done|complete|completed|finished|shipped|launched)\b/gi, value: true },
    {
      regex: /\b(todo|backlog|pending|blocked|tbd|in progress|wip|later|paused|stalled)\b/gi,
      value: false,
    },
  ] as const;

  for (const { regex, value: result } of patterns) {
    if (regex.test(text)) {
      text = text.replace(regex, "").replace(/\(\s*\)/g, "");
      done = result;
      break;
    }
  }

  return { text: normalizeWhitespace(text), done };
}

function parseTaskString(raw: string): { name: string; done?: boolean } {
  const withoutBullet = stripBulletPrefix(raw);
  const { text: afterCheckbox, done: checkboxDone } = parseCheckboxPrefix(withoutBullet);
  const { text: afterEmoji, done: emojiDone } = stripEmojiIndicators(afterCheckbox);
  const { text: cleaned, done: suffixDone } = stripStatusSuffix(afterEmoji);

  const done = checkboxDone ?? emojiDone ?? suffixDone;
  return { name: cleaned, done };
}

function parseStatusValue(value: unknown, seen: Set<unknown> = new Set()): boolean | undefined {
  if (value === null || value === undefined) return undefined;
  if (seen.has(value)) return undefined;
  seen.add(value);

  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return undefined;
    if (value <= 0) return false;
    if (value >= 1) return true;
    return undefined;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const lower = trimmed.toLowerCase();
    if (/[✅☑️✔️✓]/u.test(trimmed)) return true;
    if (/[❌⛔️🚫🛑]/u.test(trimmed)) return false;

    const percentMatch = lower.match(/(-?\d+(?:\.\d+)?)%/);
    if (percentMatch) {
      const pct = Number.parseFloat(percentMatch[1]);
      if (!Number.isNaN(pct)) {
        if (pct >= 100) return true;
        if (pct <= 0) return false;
      }
    }

    const numeric = Number.parseFloat(lower);
    if (!Number.isNaN(numeric)) {
      if (numeric <= 0) return false;
      if (numeric >= 1) return true;
    }

    const cleaned = lower.replace(/[^a-z0-9]+/g, " ").trim();
    if (!cleaned) return undefined;

    const containsNegative = NEGATIVE_STATUS_KEYWORDS.some((token) => cleaned.includes(token));
    if (containsNegative) return false;
    const containsPositive = POSITIVE_STATUS_KEYWORDS.some((token) => cleaned.includes(token));
    if (containsPositive) return true;
    return undefined;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      const candidate = parseStatusValue(entry, seen);
      if (candidate !== undefined) return candidate;
    }
    return undefined;
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const prioritizedKeys = [
      "done",
      "isDone",
      "is_done",
      "complete",
      "completed",
      "finished",
      "status",
      "state",
      "value",
      "result",
      "progress",
      "percent",
      "percentage",
    ];

    for (const key of prioritizedKeys) {
      if (!(key in record)) continue;
      const candidate = parseStatusValue(record[key], seen);
      if (candidate !== undefined) return candidate;
    }

    if (typeof record.percentage === "number") {
      if (record.percentage >= 100) return true;
      if (record.percentage <= 0) return false;
    }
    if (typeof record.percent === "number") {
      if (record.percent >= 100) return true;
      if (record.percent <= 0) return false;
    }
    if (typeof record.progress === "number") {
      if (record.progress >= 100) return true;
      if (record.progress <= 0) return false;
    }
  }

  return undefined;
}

type TaskDescriptor = {
  name?: string;
  manual?: boolean;
  done?: boolean;
  note?: string;
  manualKey?: string;
  checks?: Check[];
};

function parseTaskDescriptor(input: unknown): TaskDescriptor {
  if (typeof input === "string") {
    const parsed = parseTaskString(input);
    return { name: parsed.name, done: parsed.done };
  }

  if (input && typeof input === "object") {
    const record = input as Record<string, unknown>;
    const candidate = record.task || record.title || record.name;
    const name = typeof candidate === "string" ? candidate.trim() : undefined;
    const manual = typeof record.manual === "boolean" ? record.manual : undefined;
    const note = typeof record.note === "string" ? record.note.trim() : undefined;
    const manualKey = typeof record.manualKey === "string"
      ? record.manualKey.trim()
      : typeof record.manual_key === "string"
        ? record.manual_key.trim()
        : typeof record.key === "string"
          ? record.key.trim()
          : undefined;
    const doneCandidate =
      record.done ??
      record.complete ??
      record.completed ??
      record.finished ??
      record.status ??
      record.state ??
      record.progress ??
      record.percent ??
      record.percentage;
    const done = parseStatusValue(doneCandidate);

    const checksRaw = Array.isArray(record.checks) ? record.checks : [];
    const checks = checksRaw
      .map((entry) => (entry && typeof entry === "object" ? (entry as Check) : null))
      .filter((entry): entry is Check => Boolean(entry?.type));

    return { name, manual, done, note, manualKey, checks };
  }

  return {};
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
      const items = tasks.reduce<RoadmapItem[]>((acc, task: unknown, taskIndex) => {
        const descriptor = parseTaskDescriptor(task);
        const name = descriptor.name?.trim();
        if (!name) return acc;
        const id = slugify(
          `${phaseLabel}-${name}`,
          `task-${phaseIndex + 1}-${milestoneIndex + 1}-${taskIndex + 1}`,
        );

        const checks = Array.isArray(descriptor.checks) ? descriptor.checks : [];
        const manual =
          typeof descriptor.manual === "boolean" ? descriptor.manual : checks.length === 0;

        const item: RoadmapItem = {
          id,
          name,
          checks,
          manual,
        };

        if (descriptor.done !== undefined) {
          item.done = descriptor.done;
        } else if (manual) {
          item.done = false;
        }

        if (descriptor.note) {
          item.note = descriptor.note;
        }

        if (descriptor.manualKey) {
          item.manualKey = descriptor.manualKey;
        }

        acc.push(item);

        return acc;
      }, []);

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
        const checks: any[] = [];
        for (const c of (it.checks as Check[]) ?? []) {
          hadChecks = true;
          let r;
          if (c.type === "files_exist") r = await files_exist(owner, repo, c, branch);
          else if (c.type === "http_ok") r = await http_ok(c.url!, c.must_match || []);
          else if (c.type === "sql_exists") {
            if (!probeUrl) r = { ok: false, error: "probeUrl not provided" };
            else r = await sql_exists(probeUrl, c.query!, combinedProbeHeaders);
          } else r = { ok: false, error: "unknown check" };
          const ok = typeof r.ok === "boolean" ? r.ok : undefined;
          const statusValue = ok === undefined ? "unknown" : ok ? "pass" : "fail";
          const payload = {
            ...c,
            ...r,
            ...(ok !== undefined ? { ok } : {}),
            status: statusValue,
            result: statusValue,
          };
          checks.push(payload);
          if (ok !== true) passed = false;
        }
        const manual = it.manual === true;
        const note = typeof it.note === "string" ? it.note : undefined;
        const manualKey = typeof it.manualKey === "string" ? it.manualKey : undefined;
        const itemDone = hadChecks ? passed : it.done === true;
        const item: any = { id: it.id, name: it.name, done: itemDone, checks };
        item.results = checks;
        if (manual) item.manual = true;
        if (note) item.note = note;
        if (manualKey) item.manualKey = manualKey;
        W.items.push(item);
      }
      status.weeks.push(W);
    }

    let manualState: ManualState | null = null;
    try {
      const manualResult = await loadManualState(owner, repo, projectKey ?? null);
      if (manualResult.available) {
        manualState = manualResult.state;
      }
    } catch (error) {
      console.error("Failed to load manual roadmap overrides", error);
    }
    if (manualState && Object.keys(manualState).length > 0) {
      status.weeks = applyManualAdjustments(status.weeks, manualState);
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
