// app/api/status/[owner]/[repo]/route.ts
import { NextResponse } from "next/server";
import { getInstallationToken } from "@/lib/githubApp";

export const runtime = "nodejs";

const DEFAULT_BRANCH = process.env.DEFAULT_BRANCH || "main";

export async function GET(
  _req: Request,
  { params }: { params: { owner: string; repo: string } }
) {
  const { owner, repo } = params;

  let token: string | undefined;
  try {
    token = await getInstallationToken();
  } catch {
    // silently fallback to unauthenticated fetch
  }

  if (token) {
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/docs/roadmap-status.json?ref=${DEFAULT_BRANCH}`;
    const r = await fetch(apiUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "roadmap-dashboard",
      },
      next: { revalidate: 30 },
    });
    if (r.ok) {
      const data = (await r.json()) as {
        content?: string;
        encoding?: string;
      };
      const raw =
        data.content && data.encoding === "base64"
          ? Buffer.from(data.content, "base64").toString("utf8")
          : await r.text();
      return new NextResponse(raw, {
        headers: {
          "content-type": "application/json",
          "cache-control": "public, max-age=0, must-revalidate",
        },
      });
    }
  }

  // Public fallback (raw.githubusercontent.com)
  const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${DEFAULT_BRANCH}/docs/roadmap-status.json`;
  const res = await fetch(rawUrl, { next: { revalidate: 30 } });
  if (!res.ok) {
    return NextResponse.json(
      {
        ok: false,
        note: "status file not found",
        status: res.status,
        url: rawUrl,
      },
      { status: 404 }
    );
  }
  const json = await res.json();
  return NextResponse.json(json, {
    headers: { "cache-control": "public, max-age=0, must-revalidate" },
  });
}