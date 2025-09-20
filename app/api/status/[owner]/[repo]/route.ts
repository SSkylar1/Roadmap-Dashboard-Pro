// app/api/status/[owner]/[repo]/route.ts
import { NextResponse } from "next/server";
import yaml from "js-yaml";

export const runtime = "nodejs";

const DEFAULT_BRANCH = process.env.DEFAULT_BRANCH || "main";
const REVALIDATE_SECS = 15;
const UA = "roadmap-dashboard-pro";

function hasGitHubAppConfig() {
  return Boolean(
    process.env.GH_APP_ID &&
      (process.env.GH_APP_PRIVATE_KEY_B64 || process.env.GH_APP_PRIVATE_KEY)
  );
}

async function tryGetInstallationToken(): Promise<string | undefined> {
  if (!hasGitHubAppConfig()) return undefined;
  try {
    const mod = await import("@/lib/githubApp");
    return await mod.getInstallationToken();
  } catch {
    return undefined;
  }
}

type Ctx = { params: { owner: string; repo: string } };
type GHContentsResp = { content?: string; encoding?: string };

function ghHeaders(token?: string) {
  const h: Record<string, string> = { Accept: "application/vnd.github+json", "User-Agent": UA };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

async function fetchJSON(url: string, token?: string) {
  const r = await fetch(url, { headers: ghHeaders(token), next: { revalidate: REVALIDATE_SECS } });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} for ${url}`);
  return r.json();
}
async function fetchText(url: string, token?: string) {
  const r = await fetch(url, { headers: ghHeaders(token), next: { revalidate: REVALIDATE_SECS } });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} for ${url}`);
  return r.text();
}

/** Repo default branch (best-effort) */
async function detectDefaultBranch(owner: string, repo: string, token?: string) {
  if (!token) return null;
  try {
    const j = (await fetchJSON(`https://api.github.com/repos/${owner}/${repo}`, token)) as {
      default_branch?: string;
    };
    return j.default_branch ?? null;
  } catch {
    return null;
  }
}

/** Contents API → decode base64 if present */
async function fetchViaContentsAPI(owner: string, repo: string, path: string, ref: string, token?: string) {
  if (!token) return null;
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(
    path
  )}?ref=${encodeURIComponent(ref)}`;
  const r = await fetch(url, { headers: ghHeaders(token), next: { revalidate: REVALIDATE_SECS } });
  if (!r.ok) return null;

  try {
    const data = (await r.json()) as GHContentsResp;
    if (data?.content && data.encoding === "base64") {
      return Buffer.from(data.content, "base64").toString("utf8");
    }
    return await r.text();
  } catch {
    return await r.text();
  }
}
/** raw.githubusercontent.com (unauth) */
async function fetchViaRaw(owner: string, repo: string, path: string, ref: string) {
  const url = `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(ref)}/${path}`;
  const r = await fetch(url, { headers: ghHeaders(), next: { revalidate: REVALIDATE_SECS } });
  if (!r.ok) return null;
  return r.text();
}
/** Try API then raw */
async function loadFile(owner: string, repo: string, path: string, ref: string, token?: string) {
  const viaApi = await fetchViaContentsAPI(owner, repo, path, ref, token);
  if (viaApi !== null) return viaApi;
  const viaRaw = await fetchViaRaw(owner, repo, path, ref);
  if (viaRaw !== null) return viaRaw;
  return null;
}

/** HEAD/GET presence check for a repo path */
async function fileExists(owner: string, repo: string, path: string, ref: string, token?: string) {
  if (token) {
    const u = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(
      path
    )}?ref=${encodeURIComponent(ref)}`;
    const r = await fetch(u, { headers: ghHeaders(token), next: { revalidate: REVALIDATE_SECS } });
    if (r.ok) return true;
  }
  const url = `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(ref)}/${path}`;
  const r = await fetch(url, { method: "GET", headers: ghHeaders(), next: { revalidate: REVALIDATE_SECS } });
  return r.ok;
}

/** tiny helpers */
const asArray = <T,>(x: T | T[] | undefined): T[] =>
  Array.isArray(x) ? x : x !== undefined ? [x] : [];

/** Execute one check; returns {status, note} */
async function runCheck(
  owner: string,
  repo: string,
  branch: string,
  token: string | undefined,
  rc: any,
  check: any
): Promise<{ status: "pass" | "fail" | "skip"; note?: string }> {
  const type = String(check?.type || "").trim();

  if (type === "files_exist") {
    const detailList: string[] =
      typeof check.detail === "string"
        ? check.detail.split(",").map((s: string) => s.trim()).filter(Boolean)
        : [];

    const paths: string[] = [
      ...asArray<string>(check.files),
      ...asArray<string>(check.globs),
      ...detailList,
    ];

    if (paths.length === 0) return { status: "skip", note: "no paths provided" };

    for (const p of paths) {
      // eslint-disable-next-line no-await-in-loop
      const ok = await fileExists(owner, repo, p, branch, token);
      if (!ok) return { status: "fail", note: `missing: ${p}` };
    }
    return { status: "pass", note: `${paths.length} file(s) present` };
  }

  if (type === "http_ok") {
    const url = check.url || check.detail;
    if (!url) return { status: "skip", note: "no url" };
    try {
      const r = await fetch(url, { next: { revalidate: 0 } });
      if (!r.ok) return { status: "fail", note: `HTTP ${r.status}` };
      const body = await r.text();
      const must = asArray<string>(check.must_match);
      const misses = must.filter((m) => !body.includes(m));
      if (misses.length) return { status: "fail", note: `missing substrings: ${misses.join(", ")}` };
      return { status: "pass", note: `HTTP ${r.status}` };
    } catch (e: any) {
      return { status: "fail", note: e?.message || "fetch failed" };
    }
  }

  if (type === "sql_exists") {
    const q = check.query || check.detail;
    const envUrl =
      process.env.READ_ONLY_CHECKS_URL ||
      rc?.envs?.dev?.READ_ONLY_CHECKS_URL ||
      rc?.envs?.prod?.READ_ONLY_CHECKS_URL;
    if (!envUrl) return { status: "skip", note: "READ_ONLY_CHECKS_URL not configured" };
    if (!q) return { status: "skip", note: "no query" };
    try {
      const r = await fetch(envUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: q }),
        next: { revalidate: 0 },
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok && (j.ok === true || j.exists === true)) return { status: "pass", note: "ok" };
      return { status: "fail", note: `edge returned ${r.status}${j?.error ? `: ${j.error}` : ""}` };
    } catch (e: any) {
      return { status: "fail", note: e?.message || "edge call failed" };
    }
  }

  return { status: "skip", note: `unknown type: ${type}` };
}

const PASS_STATUSES = new Set([
  "pass",
  "passed",
  "ok",
  "success",
  "succeeded",
  "complete",
  "completed",
  "done",
  "✅",
]);
const FAIL_STATUSES = new Set(["fail", "failed", "error", "missing", "❌"]);

function normalizeStatusValue(val: unknown) {
  return typeof val === "string" ? val.trim().toLowerCase() : "";
}

function inferOk(status: unknown, fallback?: unknown): boolean | undefined {
  if (typeof fallback === "boolean") return fallback;
  const norm = normalizeStatusValue(status);
  if (PASS_STATUSES.has(norm)) return true;
  if (FAIL_STATUSES.has(norm)) return false;
  if (norm === "skip" || norm === "skipped" || norm === "pending") return undefined;
  return undefined;
}

function textOrNull(val: unknown) {
  if (typeof val !== "string") return undefined;
  const trimmed = val.trim();
  return trimmed ? trimmed : undefined;
}

function mergeDetail(detail: unknown, note: unknown) {
  const base = textOrNull(detail);
  const extra = textOrNull(note);
  if (base && extra && base !== extra) return `${base} – ${extra}`;
  return extra ?? base;
}

function cloneCheck(check: any) {
  if (check && typeof check === "object" && !Array.isArray(check)) {
    return { ...check };
  }
  if (typeof check === "string") {
    return { type: check };
  }
  return { type: "unknown" };
}

type EnrichMode = "live" | "artifact";

async function enrichWeeks(
  weeks: any,
  ctx: {
    owner: string;
    repo: string;
    branch: string;
    token?: string;
    rc: any;
    mode: EnrichMode;
  }
) {
  const sourceWeeks = Array.isArray(weeks) ? weeks : [];
  const out: any[] = [];

  for (const week of sourceWeeks) {
    if (!week || typeof week !== "object") {
      out.push(week);
      continue;
    }

    const sourceItems = Array.isArray((week as any).items) ? (week as any).items : [];
    const itemsOut: any[] = [];

    for (const item of sourceItems) {
      if (!item || typeof item !== "object") {
        itemsOut.push(item);
        continue;
      }

      const itemObj: any = { ...item };
      const sourceChecks = Array.isArray(item.checks) ? item.checks : [];
      const checksOut: any[] = [];

      if (ctx.mode === "live") {
        for (const check of sourceChecks) {
          const base = cloneCheck(check);
          // eslint-disable-next-line no-await-in-loop
          const result = await runCheck(ctx.owner, ctx.repo, ctx.branch, ctx.token, ctx.rc, check);
          base.status = result.status;
          base.result = result.status;
          if (result.note !== undefined) base.note = result.note;
          const detail = mergeDetail(base.detail, result.note);
          if (detail !== undefined) base.detail = detail;
          base.ok = inferOk(result.status);
          checksOut.push(base);
        }
      } else {
        for (const check of sourceChecks) {
          const base = cloneCheck(check);
          const status = base.result ?? base.status;
          base.result = status;
          base.ok = inferOk(status, base.ok);
          const detail = mergeDetail(base.detail, base.note);
          if (detail !== undefined) base.detail = detail;
          checksOut.push(base);
        }
      }

      itemObj.checks = checksOut;

      const computedDone = checksOut.length > 0 ? checksOut.every((c) => c.ok === true) : undefined;
      const explicitDone = typeof item.done === "boolean" ? item.done : undefined;

      if (computedDone !== undefined) itemObj.done = computedDone;
      else if (explicitDone !== undefined) itemObj.done = explicitDone;
      else delete itemObj.done;

      itemsOut.push(itemObj);
    }

    out.push({ ...week, items: itemsOut });
  }

  return out;
}

export async function GET(_req: Request, { params }: Ctx) {
  const { owner, repo } = params;

  const token = await tryGetInstallationToken();

  const branch = (await detectDefaultBranch(owner, repo, token)) || DEFAULT_BRANCH;

  const statusPath = "docs/roadmap-status.json";
  const statusTxt = await loadFile(owner, repo, statusPath, branch, token);
  if (statusTxt) {
    try {
      const json = JSON.parse(statusTxt);
      const weeks = await enrichWeeks(json?.weeks, { owner, repo, branch, token, rc: null, mode: "artifact" });
      const payload: any = {
        ...json,
        owner: json?.owner ?? owner,
        repo: json?.repo ?? repo,
        branch: json?.branch ?? branch,
        weeks,
      };

      const sourceMeta =
        payload?.source && typeof payload.source === "object" && !Array.isArray(payload.source)
          ? payload.source
          : {};
      payload.source = { ...sourceMeta, artifact: statusPath };

      return NextResponse.json(payload, {
        headers: { "cache-control": "no-store", "x-status-route": "artifact" },
      });
    } catch {}
  }

  let rc: any = null;
  let roadmapPath = "docs/roadmap.yml";
  const rcTxt = await loadFile(owner, repo, ".roadmaprc.json", branch, token);
  if (rcTxt) {
    try {
      rc = JSON.parse(rcTxt);
      if (rc?.roadmapFile && typeof rc.roadmapFile === "string") roadmapPath = rc.roadmapFile;
    } catch {}
  }

  const roadmapTxt = await loadFile(owner, repo, roadmapPath, branch, token);
  if (!roadmapTxt) {
    return NextResponse.json(
      { ok: false, error: "STATUS_NOT_FOUND", owner, repo, branch },
      { status: 404, headers: { "cache-control": "no-store", "x-status-route": "missing" } }
    );
  }

  let doc: any = {};
  try {
    doc = yaml.load(roadmapTxt) as any;
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "YAML_PARSE_FAILED", message: e?.message || String(e) },
      { status: 500, headers: { "cache-control": "no-store" } }
    );
  }

  const weeks = await enrichWeeks(doc?.weeks, { owner, repo, branch, token, rc, mode: "live" });

  return NextResponse.json(
    {
      ok: true,
      generated_at: new Date().toISOString(),
      env: process.env.VERCEL_ENV ?? "dev",
      owner,
      repo,
      branch,
      source: { rc: !!rcTxt, roadmap: roadmapPath },
      weeks,
    },
    { headers: { "cache-control": "no-store", "x-status-route": "yaml-live" } }
  );
}
