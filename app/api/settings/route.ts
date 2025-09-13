import { NextRequest, NextResponse } from "next/server";
import { getTokenForRepo } from "@/lib/token";
import { openEditRcPR } from "@/lib/github-pr";

export async function GET(req: NextRequest) {
  const owner = req.nextUrl.searchParams.get('owner') || '';
  const repo  = req.nextUrl.searchParams.get('repo') || '';
  if (!owner || !repo) return NextResponse.json({ error: "missing params" }, { status: 400 });

  const token = await getTokenForRepo(owner, repo);
  const r = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/.roadmaprc.json`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github.v3.raw" },
    cache: "no-store"
  });
  if (!r.ok) return NextResponse.json({ error: `fetch rc failed: ${r.status}` }, { status: 500 });
  const text = await r.text();
  return NextResponse.json({ content: text });
}

export async function POST(req: NextRequest) {
  try {
    const { owner, repo, branch, content } = await req.json();
    if (!owner || !repo || !branch || !content) return NextResponse.json({ error: "missing fields" }, { status: 400 });
    const token = await getTokenForRepo(owner, repo);
    const pr = await openEditRcPR({ owner, repo, token, branch, newContent: content });
    return NextResponse.json({ url: pr.html_url || null, number: pr.number || null });
  } catch (e:any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
