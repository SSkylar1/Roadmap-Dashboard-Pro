// app/api/status/[owner]/[repo]/route.ts
import { NextResponse } from "next/server";
import yaml from "js-yaml";
import { getInstallationToken } from "@/lib/githubApp";

export const runtime = "nodejs";

const DEFAULT_BRANCH = process.env.DEFAULT_BRANCH || "main";
const REVALIDATE_SECS = 30;
const UA = "roadmap-dashboard";

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

/** Get repo default branch (if token present) */
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

/** Try GitHub Contents API for a given path; return raw string if base64 */
async function fetchViaContentsAPI(owner: string, repo: string, path: string, ref: string, token?: string) {
  if (!token) return null;
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(ref)}`;
  const r = await fetch(url, { headers: ghHeaders(token), next: { revalidate: REVALIDATE_SECS } });
  if (!r.ok) return null;

  try {
    const data = (await r.json()) as GHContentsResp;
    if (data?.content && data.encoding === "base64") {
      return Buffer.from(data.content, "base64").toString("utf8");
    }
    // fallback if GitHub returns raw JSON
    return JSON.stringify(data, null, 2);
  } catch {
    return await r.text();
  }
}

/** Try raw.githubusercontent.com for a given path; return text or null */
async function fetchViaRaw(owner: string, repo: string, path: string, ref: string) {
  const url = `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(ref)}/${path}`;
  const r = await fetch(url, { headers: ghHeaders(), next: { revalidate: REVALIDATE_SECS } });
  if (!r.ok) return null;
  return r.text();
}

/** Load text for a path, trying API (auth) then raw (unauth) */
async function loadFile(owner: string, repo: string, path: string, ref: string, token?: string) {
  const viaApi = await fetchViaContentsAPI(owner, repo, path, ref, token);
  if (viaApi !== null) return viaApi;
  const viaRaw = await fetchViaRaw(owner, repo, path, ref);
  if (viaRaw !== null) return viaRaw;
  return null;
}

export async function GET(_req: Request, { params }: Ctx) {
  const { owner, repo } = params;

  // 1) Optional auth (needed for private repos or higher rate limits)
  let token: string | undefined;
  try {
    token = await getInstallationToken();
  } catch {
    // proceed unauthenticated
  }

  // 2) Pick a branch
  let branch = (await detectDefaultBranch(owner, repo, token)) || DEFAULT_BRANCH;

  // 3) Try the generated artifact first: docs/roadmap-status.json
  const statusPath = "docs/roadmap-status.json";
  const statusTxtDetected = await loadFile(owner, repo, statusPath, branch, token);
  if (statusTxtDetected) {
    // ensure valid JSON string response
    try {
      const json = JSON.parse(statusTxtDetected);
      return NextResponse.json(json, {
        headers: { "cache-control": "public, max-age=0, must-revalidate" },
      });
    } catch {
      // if it wasn't JSON, just pass it through
      return new NextResponse(statusTxtDetected, {
        headers: {
          "content-type": "application/json",
          "cache-control": "public, max-age=0, must-revalidate",
        },
      });
    }
  }

  // 4) Fallback: read .roadmaprc.json to discover roadmap file
  let roadmapPath = "docs/roadmap.yml";
  const rcTxt = await loadFile(owner, repo, ".roadmaprc.json", branch, token);
  if (rcTxt) {
    try {
      const rc = JSON.parse(rcTxt);
      if (rc?.roadmapFile && typeof rc.roadmapFile === "string") {
        roadmapPath = rc.roadmapFile;
      }
    } catch {
      // ignore malformed rc; use default path
    }
  }

  // 5) Load and parse roadmap YAML
  const roadmapTxt = await loadFile(owner, repo, roadmapPath, branch, token);
  if (roadmapTxt) {
    try {
      const doc = yaml.load(roadmapTxt) as any;
      const weeks = Array.isArray(doc?.weeks) ? doc.weeks : [];
      return NextResponse.json(
        {
          generated_at: new Date().toISOString(),
          env: "dev",
          owner,
          repo,
          branch,
          source: { rc: !!rcTxt, roadmap: roadmapPath },
          weeks,
        },
        { headers: { "cache-control": "public, max-age=0, must-revalidate" } }
      );
    } catch (e: any) {
      return NextResponse.json(
        {
          ok: false,
          error: "YAML_PARSE_FAILED",
          message: e?.message || String(e),
          owner,
          repo,
          branch,
          roadmapPath,
        },
        { status: 500 }
      );
    }
  }

  // 6) Nothing found
  return NextResponse.json(
    {
      ok: false,
      error: "STATUS_NOT_FOUND",
      note: "Neither docs/roadmap-status.json nor the roadmap YAML were found.",
      owner,
      repo,
      branchTried: branch,
      roadmapTried: roadmapPath,
      usedAuth: Boolean(token),
    },
    { status: 404 }
  );
}
