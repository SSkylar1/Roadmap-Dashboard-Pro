import { NextResponse } from "next/server";
import { getInstallationToken } from "@/lib/githubApp"; 

export const runtime = "nodejs";

const DEFAULT_BRANCH = process.env.DEFAULT_BRANCH || "main";
const REVALIDATE_SECS = 30;

type GHContentsResp = {
  content?: string;
  encoding?: string;
};

/** Try to detect the repo’s default branch when authenticated */
async function fetchRepoDefaultBranch(
  owner: string,
  repo: string,
  token: string
): Promise<string | null> {
  const r = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "roadmap-dashboard",
    },
    next: { revalidate: REVALIDATE_SECS },
  });
  if (!r.ok) return null;
  const j = (await r.json()) as { default_branch?: string };
  return j.default_branch ?? null;
}

/** Fetch status file via GitHub Contents API */
async function fetchRoadmapStatusViaAPI(
  owner: string,
  repo: string,
  branch: string,
  token: string
): Promise<Response | null> {
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/docs/roadmap-status.json?ref=${encodeURIComponent(
    branch
  )}`;

  const r = await fetch(apiUrl, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "roadmap-dashboard",
    },
    next: { revalidate: REVALIDATE_SECS },
  });

  if (!r.ok) return null;

  try {
    const data = (await r.json()) as GHContentsResp;
    const raw =
      data.content && data.encoding === "base64"
        ? Buffer.from(data.content, "base64").toString("utf8")
        : JSON.stringify(data);

    return new NextResponse(raw, {
      headers: {
        "content-type": "application/json",
        "cache-control": "public, max-age=0, must-revalidate",
      },
    });
  } catch {
    const raw = await r.text();
    return new NextResponse(raw, {
      headers: {
        "content-type": "application/json",
        "cache-control": "public, max-age=0, must-revalidate",
      },
    });
  }
}

/** Fetch status file via raw.githubusercontent.com (unauthenticated) */
async function fetchRoadmapStatusRaw(
  owner: string,
  repo: string,
  branch: string
): Promise<Response | null> {
  const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(
    branch
  )}/docs/roadmap-status.json`;

  const res = await fetch(rawUrl, { next: { revalidate: REVALIDATE_SECS } });
  if (!res.ok) return null;

  const json = await res.json();
  return NextResponse.json(json, {
    headers: { "cache-control": "public, max-age=0, must-revalidate" },
  });
}

export async function GET(
  _req: Request,
  { params }: { params: { owner: string; repo: string } }
) {
  const { owner, repo } = params;

  let token: string | undefined;
  try {
    token = await getInstallationToken();
  } catch {
    // ignore; fall back to unauthenticated fetch
  }

  if (token) {
    let branch = DEFAULT_BRANCH;
    try {
      const detected = await fetchRepoDefaultBranch(owner, repo, token);
      if (detected) branch = detected;
    } catch {
      // keep DEFAULT_BRANCH
    }

    const viaApi = await fetchRoadmapStatusViaAPI(owner, repo, branch, token);
    if (viaApi) return viaApi;

    const viaRawDetected = await fetchRoadmapStatusRaw(owner, repo, branch);
    if (viaRawDetected) return viaRawDetected;
  }

  const viaRawDefault = await fetchRoadmapStatusRaw(owner, repo, DEFAULT_BRANCH);
  if (viaRawDefault) return viaRawDefault;

  return NextResponse.json(
    {
      ok: false,
      note: "roadmap-status.json not found in docs/",
      owner,
      repo,
      triedBranch: DEFAULT_BRANCH,
      usedAuth: Boolean(token),
    },
    { status: 404 }
  );
}