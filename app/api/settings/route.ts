import { NextRequest, NextResponse } from "next/server";

import { openEditRcPR } from "@/lib/github-pr";
import { loadSecrets } from "@/lib/server-secrets";
import { authHeaders, getTokenForRepo } from "@/lib/token";

export async function GET(req: NextRequest) {
  const owner = req.nextUrl.searchParams.get("owner");
  const repo = req.nextUrl.searchParams.get("repo");

  if (!owner && !repo) {
    try {
      const secrets = await loadSecrets();
      return NextResponse.json({ secrets });
    } catch (error) {
      const message = error instanceof Error ? error.message : "failed to load secrets";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  if (!owner || !repo) {
    return NextResponse.json({ error: "missing params" }, { status: 400 });
  }

  const auth = await getTokenForRepo(owner, repo);
  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/.roadmaprc.json`, {
    headers: authHeaders(auth, { Accept: "application/vnd.github.v3.raw" }),
    cache: "no-store",
  });
  if (!response.ok) {
    return NextResponse.json({ error: `fetch rc failed: ${response.status}` }, { status: 500 });
  }
  const text = await response.text();
  return NextResponse.json({ content: text });
}

export async function POST(req: NextRequest) {
  try {
    const { owner, repo, branch, content } = await req.json();
    if (!owner || !repo || !branch || !content) {
      return NextResponse.json({ error: "missing fields" }, { status: 400 });
    }
    const auth = await getTokenForRepo(owner, repo);
    const pr = await openEditRcPR({ owner, repo, auth, branch, newContent: content });
    return NextResponse.json({ url: pr.html_url || null, number: pr.number || null });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
