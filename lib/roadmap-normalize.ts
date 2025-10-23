import yaml from "js-yaml";

export type NormalizedRoadmapCheck = {
  type: "files_exist" | "http_ok" | "sql_exists";
  files?: string[];
  globs?: string[];
  detail?: string;
  url?: string;
  must_match?: string[];
  query?: string;
};

export type NormalizedRoadmapItem = {
  id: string;
  name: string;
  checks: NormalizedRoadmapCheck[];
  manual?: boolean;
  done?: boolean;
  note?: string;
  manualKey?: string;
};

export type NormalizedRoadmapWeek = {
  id: string;
  title: string;
  items: NormalizedRoadmapItem[];
};

export type NormalizedRoadmapDocument = {
  version: 1;
  weeks: NormalizedRoadmapWeek[];
};

const KNOWN_CHECK_TYPES = new Set(["files_exist", "http_ok", "sql_exists"]);

function computeHashSuffix(value: string, length = 6) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33 + value.charCodeAt(index)) >>> 0;
  }
  const base36 = hash.toString(36);
  if (base36.length >= length) {
    return base36.slice(-length);
  }
  return base36.padStart(length, "0");
}

function slugify(value: string, fallback: string) {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (!normalized) {
    return fallback;
  }

  if (normalized.length <= 64) {
    return normalized;
  }

  const hash = computeHashSuffix(normalized);
  const maxBaseLength = Math.max(0, 64 - hash.length - 1);
  const trimmed = normalized.slice(0, maxBaseLength).replace(/-+$/g, "");
  const slug = [trimmed, hash].filter(Boolean).join("-");
  return slug || fallback;
}

function pickString(...candidates: unknown[]): string | undefined {
  for (const candidate of candidates) {
    if (typeof candidate === "string") {
      const trimmed = candidate.trim();
      if (trimmed) return trimmed;
    }
    if (Array.isArray(candidate)) {
      for (const entry of candidate) {
        if (typeof entry === "string") {
          const trimmed = entry.trim();
          if (trimmed) return trimmed;
        }
      }
    }
  }
  return undefined;
}

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  return [value];
}

function collectStrings(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectStrings(entry)).filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(/[\n,]+/)
      .map((part) => part.trim())
      .filter(Boolean);
  }
  if (value && typeof value === "object") {
    return collectStrings(Object.values(value));
  }
  return [];
}

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

function coerceBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return undefined;
    if (value <= 0) return false;
    if (value >= 1) return true;
    return undefined;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return undefined;
    if (
      ["true", "yes", "y", "done", "complete", "completed", "finished", "launched", "live"].includes(
        normalized,
      )
    ) {
      return true;
    }
    if (["false", "no", "n", "todo", "pending", "blocked", "tbd", "hold", "paused", "stalled"].includes(normalized)) {
      return false;
    }
  }
  return undefined;
}

function detectCheckType(record: Record<string, unknown>): "files_exist" | "http_ok" | "sql_exists" | "" {
  const rawType = pickString(record.type, record.kind, record.check);
  if (rawType) {
    const normalized = rawType.toLowerCase().replace(/[-\s]+/g, "_");
    if (KNOWN_CHECK_TYPES.has(normalized as NormalizedRoadmapCheck["type"])) {
      return normalized as NormalizedRoadmapCheck["type"];
    }
  }

  if (record.url || record.endpoint || record.href || record.link) {
    return "http_ok";
  }
  if (record.query || record.sql || record.statement) {
    return "sql_exists";
  }
  if (record.files || record.file || record.paths || record.path || record.globs || record.glob || record.patterns) {
    return "files_exist";
  }
  return "";
}

function normalizeCheck(entry: unknown): NormalizedRoadmapCheck | null {
  if (typeof entry === "string") {
    const trimmed = entry.trim();
    if (!trimmed) return null;
    if (/^https?:\/\//i.test(trimmed)) {
      return { type: "http_ok", url: trimmed };
    }
    return { type: "files_exist", files: [trimmed] };
  }

  if (!entry || typeof entry !== "object") {
    return null;
  }

  const record = entry as Record<string, unknown>;
  const type = detectCheckType(record);
  if (!type) return null;

  if (type === "files_exist") {
    const files = dedupeStrings([
      ...collectStrings(record.files),
      ...collectStrings(record.file),
      ...collectStrings(record.paths),
      ...collectStrings(record.path),
    ]);
    const globs = dedupeStrings([
      ...collectStrings(record.globs),
      ...collectStrings(record.glob),
      ...collectStrings(record.patterns),
    ]);
    const detail = pickString(record.detail, record.note, record.description);

    if (detail) {
      for (const token of collectStrings(detail)) {
        if (!files.includes(token) && !globs.includes(token) && /[./]/.test(token)) {
          files.push(token);
        }
      }
    }

    if (!files.length && !globs.length && !detail) {
      return null;
    }

    const payload: NormalizedRoadmapCheck = { type: "files_exist" };
    if (files.length) payload.files = files;
    if (globs.length) payload.globs = globs;
    if (detail) payload.detail = detail;
    return payload;
  }

  if (type === "http_ok") {
    const url = pickString(record.url, record.endpoint, record.href, record.link, record.target);
    if (!url) return null;
    const mustMatch = dedupeStrings([
      ...collectStrings(record.must_match),
      ...collectStrings(record.mustMatch),
      ...collectStrings(record.contains),
      ...collectStrings(record.expect),
      ...collectStrings(record.matches),
    ]);
    const detail = pickString(record.detail, record.note, record.description);
    const payload: NormalizedRoadmapCheck = { type: "http_ok", url };
    if (mustMatch.length) payload.must_match = mustMatch;
    if (detail) payload.detail = detail;
    return payload;
  }

  if (type === "sql_exists") {
    const query = pickString(record.query, record.sql, record.statement);
    if (!query) return null;
    const detail = pickString(record.detail, record.note, record.description);
    const payload: NormalizedRoadmapCheck = { type: "sql_exists", query };
    if (detail) payload.detail = detail;
    return payload;
  }

  return null;
}

function normalizeChecks(record: Record<string, unknown>): NormalizedRoadmapCheck[] {
  const provided = record.checks ?? record.verifications ?? record.validation;
  const rawChecks: unknown[] = [];

  if (Array.isArray(provided)) {
    rawChecks.push(...provided);
  } else if (provided) {
    rawChecks.push(provided);
  }

  if (rawChecks.length === 0) {
    const files = dedupeStrings([
      ...collectStrings(record.files),
      ...collectStrings(record.file),
      ...collectStrings(record.paths),
      ...collectStrings(record.path),
    ]);
    const globs = dedupeStrings([
      ...collectStrings(record.globs),
      ...collectStrings(record.glob),
      ...collectStrings(record.patterns),
    ]);
    const url = pickString(record.url, record.endpoint, record.href, record.link, record.target);
    const detail = pickString(record.detail, record.note, record.description);

    if (files.length || globs.length) {
      rawChecks.push({ type: "files_exist", files, globs, detail });
    } else if (url) {
      rawChecks.push({ type: "http_ok", url, detail });
    }
  }

  return rawChecks
    .map((entry) => normalizeCheck(entry))
    .filter((entry): entry is NormalizedRoadmapCheck => Boolean(entry));
}

function canonicalizeItem(
  entry: unknown,
  context: { weekTitle: string; weekId: string; weekIndex: number; itemIndex: number },
): NormalizedRoadmapItem | null {
  if (entry === null || entry === undefined) return null;

  if (typeof entry === "string") {
    const name = entry.trim();
    if (!name) return null;
    const id = slugify(`${context.weekId}-${name}`, `item-${context.weekIndex + 1}-${context.itemIndex + 1}`);
    return { id, name, checks: [], manual: true };
  }

  if (typeof entry !== "object") {
    return null;
  }

  const record = entry as Record<string, unknown>;
  const nameCandidate =
    pickString(record.name, record.title, record.task, record.summary, record.goal, record.description) ??
    pickString(record.id);
  const name = nameCandidate?.trim();
  if (!name) {
    return null;
  }

  const idSource =
    pickString(record.id, record.key, record.slug, record.manualKey, record.manual_key) ?? `${context.weekId}-${name}`;
  const id = slugify(idSource, `item-${context.weekIndex + 1}-${context.itemIndex + 1}`);

  const checks = normalizeChecks(record);
  const manualFlag = record.manual === true || (record.manual !== false && checks.length === 0);

  const item: NormalizedRoadmapItem = { id, name, checks };

  const done = coerceBoolean(
    record.done ?? record.complete ?? record.completed ?? record.finished ?? record.status ?? record.state,
  );
  if (done !== undefined) {
    item.done = done;
  }

  if (manualFlag) {
    item.manual = true;
  }

  const note = pickString(record.note, record.notes, record.description, record.detail);
  if (note) {
    item.note = note;
  }

  const manualKey = pickString(record.manualKey, record.manual_key, record.key);
  if (manualKey) {
    item.manualKey = manualKey;
  }

  return item;
}

function flattenPhaseWeeks(roadmap: unknown): unknown[] {
  if (!Array.isArray(roadmap)) return [];
  const weeks: unknown[] = [];

  roadmap.forEach((phaseEntry, phaseIndex) => {
    if (!phaseEntry || typeof phaseEntry !== "object") return;
    const phase = phaseEntry as Record<string, unknown>;
    const phaseLabel = pickString(phase.phase, phase.title, phase.name, phase.label) || `Phase ${phaseIndex + 1}`;
    const milestones = asArray(phase.milestones ?? phase.weeks ?? phase.items);

    milestones.forEach((milestoneEntry, milestoneIndex) => {
      if (!milestoneEntry || typeof milestoneEntry !== "object") return;
      const milestone = milestoneEntry as Record<string, unknown>;
      weeks.push({
        ...milestone,
        __phaseLabel: phaseLabel,
        __phaseIndex: phaseIndex,
        __milestoneIndex: milestoneIndex,
      });
    });
  });

  return weeks;
}

function extractWeekCandidates(doc: any): unknown[] {
  if (!doc || typeof doc !== "object") return [];

  if (Array.isArray(doc.weeks)) {
    return doc.weeks as unknown[];
  }

  if (Array.isArray(doc.roadmap)) {
    return flattenPhaseWeeks(doc.roadmap);
  }

  if (Array.isArray(doc.phases)) {
    return flattenPhaseWeeks(doc.phases);
  }

  if (Array.isArray(doc)) {
    return doc as unknown[];
  }

  return [];
}

function canonicalizeWeek(input: unknown, index: number): NormalizedRoadmapWeek | null {
  if (!input || typeof input !== "object") return null;
  const record = input as Record<string, unknown>;

  const phaseLabel = pickString(record.__phaseLabel, record.phase, record.phaseLabel, record.phase_title, record.phaseName);
  const weekLabel = pickString(
    record.title,
    record.name,
    record.label,
    record.summary,
    record.heading,
    record.week,
    record.__weekLabel,
  );

  const title = [phaseLabel, weekLabel].filter(Boolean).join(" — ") || weekLabel || phaseLabel || `Week ${index + 1}`;
  const idSource = pickString(record.id, record.slug, record.key, record.week, title);
  const id = slugify(idSource || `week-${index + 1}`, `week-${index + 1}`);

  const collections = [record.items, record.tasks, record.entries, record.deliverables, record.goals];
  const rawItems = collections.flatMap((collection) => asArray(collection));

  const items: NormalizedRoadmapItem[] = [];
  rawItems.forEach((entry, itemIndex) => {
    const normalized = canonicalizeItem(entry, { weekTitle: title, weekId: id, weekIndex: index, itemIndex });
    if (normalized) {
      items.push(normalized);
    }
  });

  if (!items.length) {
    return null;
  }

  return { id, title, items };
}

export function normalizeRoadmapDocument(doc: unknown): NormalizedRoadmapDocument {
  if (!doc || typeof doc !== "object") {
    throw new Error("Roadmap YAML must parse into an object");
  }

  const weeks = extractWeekCandidates(doc).map((entry, index) => canonicalizeWeek(entry, index)).filter(Boolean);

  if (!weeks.length) {
    throw new Error("Roadmap YAML must include at least one week with items");
  }

  return { version: 1, weeks: weeks as NormalizedRoadmapWeek[] };
}

export function normalizeRoadmapYaml(source: string): string {
  const parsed = yaml.load(source);
  const normalized = normalizeRoadmapDocument(parsed);
  const text = yaml.dump(normalized, { lineWidth: 1000, noRefs: true });
  return `${text.trimEnd()}\n`;
}

