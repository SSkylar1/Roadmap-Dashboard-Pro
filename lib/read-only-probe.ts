type JsonLike = Record<string, any> | Array<any> | string | number | boolean | null | undefined;

export type ProbeHeaders = Record<string, string>;

export type ProbeOutcome = { ok: boolean; why?: string; status?: number };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function parseProbeHeaders(raw: unknown): ProbeHeaders {
  if (!raw) return {};

  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return {};
    try {
      const parsed = JSON.parse(trimmed);
      return parseProbeHeaders(parsed);
    } catch {}

    const headers: ProbeHeaders = {};
    const lines = trimmed.split(/[\n;,]+/);
    for (const line of lines) {
      const pair = line.trim();
      if (!pair) continue;
      const idx = pair.indexOf(":");
      if (idx === -1) continue;
      const key = pair.slice(0, idx).trim();
      const value = pair.slice(idx + 1).trim();
      if (key && value) {
        headers[key] = value;
      }
    }
    return headers;
  }

  if (isRecord(raw)) {
    const headers: ProbeHeaders = {};
    for (const [key, value] of Object.entries(raw)) {
      if (typeof value === "string" && value.trim()) {
        headers[key.trim()] = value.trim();
      }
    }
    return headers;
  }

  return {};
}

function matchFromEntry(query: string, entry: any): boolean | undefined {
  if (!entry) return undefined;
  if (typeof entry === "boolean") return entry;
  if (typeof entry?.ok === "boolean") return entry.ok;
  if (typeof entry === "object") {
    const candidate = (entry as Record<string, unknown>)[query];
    if (typeof candidate === "boolean") return candidate;
    if (typeof (candidate as any)?.ok === "boolean") return (candidate as any).ok;
  }
  return undefined;
}

function extractFromContainer(query: string, container: JsonLike): boolean | undefined {
  if (!container) return undefined;

  if (Array.isArray(container)) {
    for (const entry of container) {
      if (!entry) continue;
      const candidates = [entry.q, entry.query, entry.symbol, entry.id, entry.identifier, entry.name];
      if (candidates.includes(query)) {
        const matched = matchFromEntry(query, entry);
        if (typeof matched === "boolean") return matched;
      }
      const nested = matchFromEntry(query, entry);
      if (typeof nested === "boolean") return nested;
    }
    return undefined;
  }

  if (isRecord(container)) {
    if (typeof container.ok === "boolean") return container.ok;
    const direct = container[query];
    if (typeof direct === "boolean") return direct;
    if (typeof (direct as any)?.ok === "boolean") return (direct as any).ok;
    for (const value of Object.values(container)) {
      const nested = extractFromContainer(query, value as JsonLike);
      if (typeof nested === "boolean") return nested;
    }
  }

  return undefined;
}

export function extractCheckResult(query: string, payload: JsonLike): boolean | undefined {
  if (typeof payload === "boolean") return payload;
  if (!payload) return undefined;

  if (isRecord(payload)) {
    const record = payload as Record<string, unknown>;
    if (typeof record.ok === "boolean") return record.ok;

    const containers = [
      record.results,
      record.result,
      record.data,
      isRecord(record.data) ? (record.data as Record<string, unknown>).results : undefined,
      record.payload,
    ];

    for (const container of containers) {
      const matched = extractFromContainer(query, container as JsonLike);
      if (typeof matched === "boolean") return matched;
    }
  }

  if (Array.isArray(payload)) {
    return extractFromContainer(query, payload);
  }

  return undefined;
}

const ATTEMPT_BUILDERS: { label: string; build: (query: string) => string }[] = [
  { label: "queries", build: (query) => JSON.stringify({ queries: [query] }) },
  { label: "query", build: (query) => JSON.stringify({ query }) },
  { label: "symbols", build: (query) => JSON.stringify({ symbols: [query] }) },
  { label: "symbol", build: (query) => JSON.stringify({ symbol: query }) },
  { label: "symbols_single", build: (query) => JSON.stringify({ symbols: query }) },
  { label: "raw", build: (query) => JSON.stringify(query) },
];

export async function probeReadOnlyCheck(
  url: string,
  query: string,
  headers: ProbeHeaders = {},
): Promise<ProbeOutcome> {
  if (!url) {
    return { ok: false, why: "READ_ONLY_CHECKS_URL not configured" };
  }

  let lastWhy = "";
  let lastStatus: number | undefined;

  const baseHeaders: ProbeHeaders = { "content-type": "application/json", ...headers };

  for (const attempt of ATTEMPT_BUILDERS) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: baseHeaders,
        body: attempt.build(query),
      });

      const text = await response.text();
      let parsed: JsonLike = undefined;
      if (text) {
        try {
          parsed = JSON.parse(text);
        } catch {
          const normalized = text.trim().toLowerCase();
          if (["ok", "true", "ok:true"].includes(normalized)) {
            return { ok: true };
          }
        }
      }

      const ok = extractCheckResult(query, parsed);
      if (typeof ok === "boolean") {
        return { ok };
      }

      const detail =
        (parsed && (parsed as any)?.error) ||
        (parsed && (parsed as any)?.message) ||
        text.trim() ||
        `Unexpected response via ${attempt.label}`;

      if (!response.ok) {
        lastStatus = response.status;
        lastWhy = `${response.status} ${detail}`.trim();
      } else {
        lastWhy = detail;
      }
    } catch (error: any) {
      lastWhy = error?.message || String(error);
    }
  }

  return { ok: false, why: lastWhy || "Unexpected read_only_checks response", status: lastStatus };
}

