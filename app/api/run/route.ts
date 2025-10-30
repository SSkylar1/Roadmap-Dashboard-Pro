// app/api/run/route.ts
// Node runtime + no caching to ensure commits always reflect current state
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import yaml from "js-yaml";
import { STANDALONE_MODE } from "@/lib/config";
import { getFileRaw, putFile } from "@/lib/github";
import { describeProjectFile, normalizeProjectKey, projectAwarePath } from "@/lib/project-paths";
import { loadManualState } from "@/lib/manual-store";
import type { ManualState } from "@/lib/manual-state";
import { parseProbeHeaders, probeReadOnlyCheck } from "@/lib/read-only-probe";
import type { ProbeHeaders } from "@/lib/read-only-probe";
import {
  computeStandaloneRoadmapStatus,
  deriveStandaloneWorkspaceId,
  getCurrentStandaloneWorkspaceRoadmap,
  updateStandaloneRoadmapStatus,
  type StandaloneRoadmapRecord,
} from "@/lib/standalone/roadmaps-store";
import { evaluateTaskClarity } from "@/lib/task-clarity";
import { insertStandaloneStatusSnapshot } from "@/lib/standalone/status-snapshots";

type Check = {
  type: "files_exist" | "http_ok" | "sql_exists";
  globs?: string[];
  files?: string[];
  detail?: string;
  url?: string;
  must_match?: string[];
  query?: string;
};

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
  clarityScore?: number;
  clarityMissingDetails?: string[];
  clarityFollowUps?: string[];
  clarityExplanation?: string;
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

    const manualItems = (manualWeek.added ?? []).map((manualItem) => {
      const done = manualItem.done === true;
      const incomplete = manualItem.done === false;
      const progressPercent = done ? 100 : incomplete ? 0 : 0;
      return {
        id: manualItem.key,
        name: manualItem.name,
        note: manualItem.note,
        done,
        manual: true,
        manualKey: manualItem.key,
        checks: [],
        results: [],
        progress: {
          passed: done ? 1 : 0,
          failed: incomplete ? 1 : 0,
          pending: !done && !incomplete ? 1 : 0,
          total: 1,
          progressPercent,
        },
        progressPercent,
      };
    });

    return {
      ...week,
      items: [...filtered, ...manualItems],
    };
  });
}

function ensureItemProgress(rawItem: any): { item: any; summary: { passed: number; failed: number; pending: number; total: number; progressPercent: number } } {
  const item = rawItem && typeof rawItem === "object" ? { ...rawItem } : {};
  const baseProgress = item && typeof item.progress === "object" ? (item.progress as Record<string, unknown>) : {};
  const checks = Array.isArray(item.checks) ? item.checks : [];
  const fallbackTotal = checks.length;
  const fallbackPassed = checks.filter((c: any) => c?.ok === true).length;
  const fallbackFailed = checks.filter((c: any) => c?.ok === false).length;

  const totalCandidate = typeof baseProgress?.total === "number" ? baseProgress.total : fallbackTotal;
  const total = Number.isFinite(totalCandidate) && totalCandidate >= 0 ? totalCandidate : 0;
  const passedCandidate = typeof baseProgress?.passed === "number" ? baseProgress.passed : fallbackPassed;
  const passed = Number.isFinite(passedCandidate) && passedCandidate >= 0 ? passedCandidate : 0;
  const failedCandidate = typeof baseProgress?.failed === "number" ? baseProgress.failed : fallbackFailed;
  const failed = Number.isFinite(failedCandidate) && failedCandidate >= 0 ? failedCandidate : 0;
  const pendingCandidate = typeof baseProgress?.pending === "number" ? baseProgress.pending : undefined;
  const pending = Number.isFinite(pendingCandidate) && pendingCandidate !== undefined
    ? Math.max(pendingCandidate, 0)
    : Math.max(total - passed - failed, 0);

  let percentCandidate = typeof baseProgress?.progressPercent === "number" ? baseProgress.progressPercent : undefined;
  if (!Number.isFinite(percentCandidate)) {
    if (total > 0) percentCandidate = (passed / total) * 100;
    else if (item.done === true) percentCandidate = 100;
    else percentCandidate = 0;
  }
  const clampedPercent = Math.min(100, Math.max(0, percentCandidate ?? 0));
  const progressPercent = Math.round(clampedPercent * 100) / 100;

  const normalizedProgress = {
    passed,
    failed,
    pending,
    total,
    progressPercent,
  };

  item.progress = normalizedProgress;
  item.progressPercent = progressPercent;

  return { item, summary: normalizedProgress };
}

function normalizeWeeksProgress(weeks: any[]): any[] {
  if (!Array.isArray(weeks)) return weeks;
  return weeks.map((week) => {
    const items = Array.isArray(week?.items) ? week.items : [];
    let passed = 0;
    let failed = 0;
    let pending = 0;
    let total = 0;
    const normalizedItems = (items as unknown[]).map((rawItem: unknown) => {
      const { item, summary } = ensureItemProgress(rawItem);
      passed += summary.passed;
      failed += summary.failed;
      pending += summary.pending;
      total += summary.total;
      return item;
    });
    const percent = total > 0 ? Math.round((passed / total) * 10000) / 100 : 0;
    const normalizedWeek = {
      ...week,
      items: normalizedItems,
      progress: {
        passed,
        failed,
        pending,
        total,
        progressPercent: percent,
      },
      progressPercent: percent,
    };
    return normalizedWeek;
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

async function annotateClarity(
  weeks: RoadmapWeek[] | undefined,
  openAiKey?: string | null,
  signal?: AbortSignal,
) {
  if (!Array.isArray(weeks)) return;
  for (const week of weeks) {
    if (!week?.items) continue;
    for (const item of week.items) {
      if (!item || typeof item !== "object") continue;
      const alreadyAnnotated = typeof item.clarityScore === "number";
      if (alreadyAnnotated) continue;
      const candidateName =
        typeof item.name === "string" && item.name.trim()
          ? item.name.trim()
          : typeof item.id === "string"
            ? item.id
            : "";
      const candidateNote = typeof item.note === "string" ? item.note : undefined;
      const checks = Array.isArray(item.checks) ? item.checks : [];
      try {
        // eslint-disable-next-line no-await-in-loop
        const clarity = await evaluateTaskClarity(
          { title: candidateName, note: candidateNote, checks },
          { openAiKey, signal },
        );
        item.clarityScore = clarity.clarityScore;
        if (clarity.missingDetails.length > 0) {
          item.clarityMissingDetails = clarity.missingDetails;
        }
        if (clarity.followUpQuestions.length > 0) {
          item.clarityFollowUps = clarity.followUpQuestions;
        }
        if (clarity.explanation) {
          item.clarityExplanation = clarity.explanation;
        }
      } catch (error) {
        console.error("Failed to evaluate task clarity", error);
      }
    }
  }
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

function buildStandaloneWeeks(record: StandaloneRoadmapRecord): RoadmapWeek[] {
  const normalized = Array.isArray(record.normalized?.items) ? record.normalized.items : [];
  const fallbackTitle =
    typeof record.normalized?.title === "string" && record.normalized.title.trim()
      ? record.normalized.title.trim()
      : "Standalone roadmap";

  if (normalized.length === 0) {
    const fallbackId = slugify(fallbackTitle, "week-1");
    return [{ id: fallbackId, title: fallbackTitle, items: [] }];
  }

  const map = new Map<string, RoadmapWeek>();
  const order: RoadmapWeek[] = [];

  normalized.forEach((entry, index) => {
    if (!entry || typeof entry !== "object") {
      return;
    }
    const recordEntry = entry as Record<string, any>;
    const itemId = typeof recordEntry.id === "string" && recordEntry.id.trim()
      ? recordEntry.id.trim()
      : `item-${index + 1}`;
    const itemTitle = typeof recordEntry.title === "string" && recordEntry.title.trim()
      ? recordEntry.title.trim()
      : itemId;
    const phase = typeof recordEntry.phase === "string" && recordEntry.phase.trim()
      ? recordEntry.phase.trim()
      : fallbackTitle;
    const weekRange = typeof recordEntry.week_range === "string" && recordEntry.week_range.trim()
      ? recordEntry.week_range.trim()
      : "";
    const groupKey = `${phase}|||${weekRange}`;

    let week = map.get(groupKey);
    if (!week) {
      const descriptor = weekRange ? `${phase} — Weeks ${weekRange}` : phase;
      const fallbackId = `week-${order.length + 1}`;
      const weekId = slugify(`${phase}-${weekRange || order.length + 1}`, fallbackId);
      week = { id: weekId, title: descriptor, items: [] };
      map.set(groupKey, week);
      order.push(week);
    }

    const items = Array.isArray(week.items) ? week.items : (week.items = []);
    const status = typeof recordEntry.status === "string" ? recordEntry.status.trim().toLowerCase() : "";
    items.push({
      id: itemId,
      name: itemTitle,
      done: status === "done",
      manual: true,
      checks: [],
    });
  });

  return order.map((entry) => ({ ...entry, items: Array.isArray(entry.items) ? entry.items : [] }));
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
  const outcome = await probeReadOnlyCheck(probeUrl, query, headers);
  if (outcome.ok) {
    return { ok: true };
  }

  const status = outcome.status;
  const detailParts = [] as string[];
  if (typeof status === "number") {
    detailParts.push(`HTTP ${status}`);
  }
  if (outcome.why) {
    detailParts.push(outcome.why);
  }
  const detail = detailParts.join(" — ").trim();

  return {
    ok: false,
    ...(outcome.why ? { why: outcome.why, error: outcome.why } : {}),
    ...(typeof status === "number" ? { status, code: status } : {}),
    ...(detail ? { detail } : {}),
  };
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
    const openAiKey = req.headers.get("x-openai-key")?.trim() || process.env.OPENAI_API_KEY || undefined;
    if (!owner || !repo) {
      return NextResponse.json({ error: "missing owner/repo" }, { status: 400 });
    }

    if (STANDALONE_MODE) {
      const workspaceId = deriveStandaloneWorkspaceId(owner, repo);
      if (!workspaceId) {
        return NextResponse.json({ error: "invalid_workspace" }, { status: 400 });
      }

      const record = getCurrentStandaloneWorkspaceRoadmap(workspaceId);
      if (!record) {
        return NextResponse.json({ error: "standalone_roadmap_missing" }, { status: 404 });
      }

      const weeks = buildStandaloneWeeks(record);
      await annotateClarity(weeks, openAiKey, req.signal);
      const statusPayload: any = {
        generated_at: new Date().toISOString(),
        owner,
        repo,
        branch,
        project: projectKey || undefined,
        weeks,
      };

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
        statusPayload.weeks = applyManualAdjustments(statusPayload.weeks, manualState);
      }

      statusPayload.weeks = normalizeWeeksProgress(statusPayload.weeks);

      await annotateClarity(statusPayload.weeks, openAiKey, req.signal);

      const computedStatus = computeStandaloneRoadmapStatus(record.normalized);
      updateStandaloneRoadmapStatus(record.id, computedStatus);

      const snapshot = insertStandaloneStatusSnapshot({
        workspace_id: workspaceId,
        project_id: projectKey ?? null,
        branch: branch ?? null,
        payload: statusPayload,
      });

      return NextResponse.json(
        {
          ok: true,
          wrote: [],
          snapshot: statusPayload,
          meta: {
            id: snapshot.id,
            workspace_id: snapshot.workspace_id,
            project_id: snapshot.project_id,
            branch: snapshot.branch,
            created_at: snapshot.created_at,
          },
        },
        { headers: { "cache-control": "no-store" } },
      );
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
      let weekPassed = 0;
      let weekFailed = 0;
      let weekTotal = 0;
      let weekPending = 0;
      for (const it of w.items ?? []) {
        let passedAllChecks = true;
        let hadChecks = false;
        const checks: any[] = [];
        let checkPassedCount = 0;
        let checkFailedCount = 0;
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
          if (ok === true) checkPassedCount += 1;
          else if (ok === false) checkFailedCount += 1;
          if (ok !== true) passedAllChecks = false;
        }
        const manual = it.manual === true;
        const note = typeof it.note === "string" ? it.note : undefined;
        const manualKey = typeof it.manualKey === "string" ? it.manualKey : undefined;
        const totalChecks = checks.length;
        const pendingChecks = Math.max(totalChecks - checkPassedCount - checkFailedCount, 0);
        const itemDone = hadChecks ? passedAllChecks && pendingChecks === 0 : it.done === true;
        const progressTotal = hadChecks ? totalChecks : 1;
        const progressPassed = hadChecks ? checkPassedCount : itemDone ? 1 : 0;
        const progressFailed = hadChecks ? checkFailedCount : itemDone === false ? 1 : 0;
        const progressPending = hadChecks ? pendingChecks : progressTotal - progressPassed - progressFailed;
        const rawPercent = progressTotal > 0 ? (progressPassed / progressTotal) * 100 : itemDone ? 100 : 0;
        const progressPercent = Number.isFinite(rawPercent) ? Math.round(rawPercent * 100) / 100 : 0;
        if (progressTotal > 0) {
          weekTotal += progressTotal;
          weekPassed += progressPassed;
          weekFailed += progressFailed;
          if (progressPending > 0) {
            weekPending += progressPending;
          }
        }
        const item: any = {
          id: it.id,
          name: it.name,
          done: itemDone,
          checks,
          progress: {
            passed: progressPassed,
            failed: progressFailed,
            pending: Math.max(progressPending, 0),
            total: progressTotal,
            progressPercent,
          },
          progressPercent,
        };
        item.results = checks;
        if (manual) item.manual = true;
        if (note) item.note = note;
        if (manualKey) item.manualKey = manualKey;
        try {
          // eslint-disable-next-line no-await-in-loop
          const clarity = await evaluateTaskClarity(
            { title: item.name ?? item.id ?? "", note, checks },
            { openAiKey, signal: req.signal },
          );
          item.clarityScore = clarity.clarityScore;
          if (clarity.missingDetails.length > 0) {
            item.clarityMissingDetails = clarity.missingDetails;
          }
          if (clarity.followUpQuestions.length > 0) {
            item.clarityFollowUps = clarity.followUpQuestions;
          }
          if (clarity.explanation) {
            item.clarityExplanation = clarity.explanation;
          }
        } catch (error) {
          console.error("Failed to evaluate task clarity", error);
        }
        W.items.push(item);
      }
      const weekPercent = weekTotal > 0 ? Math.round((weekPassed / weekTotal) * 10000) / 100 : 0;
      W.progress = {
        passed: weekPassed,
        failed: weekFailed,
        pending: Math.max(weekPending, 0),
        total: weekTotal,
        progressPercent: weekPercent,
      };
      W.progressPercent = weekPercent;
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

    status.weeks = normalizeWeeksProgress(status.weeks);

    await annotateClarity(status.weeks, openAiKey, req.signal);

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
    const formatPercentLabel = (value: unknown): string | null => {
      if (typeof value !== "number" || !Number.isFinite(value)) return null;
      const normalized = Math.round(value * 100) / 100;
      const fixed = normalized.toFixed(2);
      const trimmed = fixed.replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
      return `${trimmed}%`;
    };

    let plan = `# Project Plan\nGenerated: ${status.generated_at}\n\n`;
    for (const w of status.weeks) {
      const title = w.title || w.id || "Untitled week";
      const weekProgressPercent =
        typeof w.progressPercent === "number" ? w.progressPercent : typeof w.progress?.progressPercent === "number" ? w.progress.progressPercent : undefined;
      const weekPercentLabel = formatPercentLabel(weekProgressPercent);
      const weekPassed = typeof w.progress?.passed === "number" ? w.progress.passed : undefined;
      const weekTotal = typeof w.progress?.total === "number" ? w.progress.total : undefined;
      const weekSummary =
        weekPercentLabel && typeof weekPassed === "number" && typeof weekTotal === "number" && weekTotal > 0
          ? `${weekPercentLabel} complete (${weekPassed}/${weekTotal})`
          : weekPercentLabel
            ? `${weekPercentLabel} complete`
            : null;
      plan += weekSummary ? `## ${title} — ${weekSummary}\n\n` : `## ${title}\n\n`;
      for (const it of w.items ?? []) {
        const badge = it.done ? "✅" : "❌";
        const name = it.name || it.id || "Untitled task";
        const identifier = it.id ? ` (${it.id})` : "";
        const itemProgressPercent =
          typeof it.progressPercent === "number"
            ? it.progressPercent
            : typeof it.progress?.progressPercent === "number"
              ? it.progress.progressPercent
              : undefined;
        const itemPercentLabel = formatPercentLabel(itemProgressPercent);
        const itemPassed = typeof it.progress?.passed === "number" ? it.progress.passed : undefined;
        const itemTotal = typeof it.progress?.total === "number" ? it.progress.total : undefined;
        let progressLabel: string | null = null;
        if (itemPercentLabel && typeof itemPassed === "number" && typeof itemTotal === "number" && itemTotal > 0) {
          progressLabel = `${itemPercentLabel} – ${itemPassed}/${itemTotal}`;
        } else if (itemPercentLabel) {
          progressLabel = itemPercentLabel;
        }
        const detail = progressLabel ? ` (${progressLabel})` : "";
        plan += `${badge}${detail} **${name}**${identifier}\n`;
      }
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
