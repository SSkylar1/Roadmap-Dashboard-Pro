// app/api/status/[owner]/[repo]/route.ts
import { NextResponse } from "next/server";
import yaml from "js-yaml";
import { getInstallationToken } from "@/lib/githubApp";

export const runtime = "nodejs";

const DEFAULT_BRANCH = process.env.DEFAULT_BRANCH || "main";
const REVALIDATE_SECS = 15;
const UA = "roadmap-dashboard-pro";

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

export async function GET(_req: Request, { params }: Ctx) {
  const { owner, repo } = params;

  let token: string | undefined;
  try {
    token = await getInstallationToken();
  } catch {}

  const branch = (await detectDefaultBranch(owner, repo, token)) || DEFAULT_BRANCH;

  const statusPath = "docs/roadmap-status.json";
  const statusTxt = await loadFile(owner, repo, statusPath, branch, token);
  if (statusTxt) {
    try {
      const json = JSON.parse(statusTxt);
      return NextResponse.json(json, { headers: { "cache-control": "no-store", "x-status-route": "artifact" } });
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

  const weeks = Array.isArray(doc?.weeks) ? doc.weeks : [];

  for (const w of weeks) {
    if (!Array.isArray(w.items)) continue;
    for (const it of w.items) {
      const checks = Array.isArray(it.checks) ? it.checks : [];
      const enrichedChecks: any[] = [];
      for (const c of checks) {
        const base: Record<string, any> =
          c && typeof c === "object"
            ? { ...c }
            : { type: typeof c === "string" ? c : "unknown" };

        // eslint-disable-next-line no-await-in-loop
        const result = await runCheck(owner, repo, branch, token, rc, c);

        const ok = result.status === "pass" ? true : result.status === "fail" ? false : undefined;
        const originalDetail = typeof base.detail === "string" ? base.detail : undefined;
        const note = result.note;

        base.ok = ok;
        base.detail = note
          ? originalDetail && note !== originalDetail
            ? `${originalDetail} – ${note}`
            : note
          : originalDetail;
        base.result = result.status;

        enrichedChecks.push(base);
      }

      it.checks = enrichedChecks;
      it.done = enrichedChecks.length > 0 && enrichedChecks.every((c) => c.ok === true);
    }
  }

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
