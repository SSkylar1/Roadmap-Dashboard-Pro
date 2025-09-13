import { NextResponse } from 'next/server';

const GH_RAW =
  'https://raw.githubusercontent.com';

export async function GET(
  _req: Request,
  { params }: { params: { owner: string; repo: string } }
) {
  const { owner, repo } = params;

  // Pull the status file (public path). If your repo is private, use the token path below.
  const url = `${GH_RAW}/${owner}/${repo}/main/docs/roadmap-status.json`;

  // If your repo can be private, switch to the GitHub Contents API:
  // const url = `https://api.github.com/repos/${owner}/${repo}/contents/docs/roadmap-status.json?ref=main`;
  // const headers: HeadersInit = {};
  // const token = process.env.GITHUB_TOKEN;
  // if (token) headers.Authorization = `Bearer ${token}`;
  // const res = await fetch(url, { headers, next: { revalidate: 30 } });
  // if (!res.ok) return NextResponse.json({ ok: false, status: res.status }, { status: res.status });
  // const data = await res.json();
  // const body = Buffer.from(data.content, 'base64').toString('utf8');
  // return new NextResponse(body, { headers: { 'content-type': 'application/json' } });

  const res = await fetch(url, { next: { revalidate: 30 } });
  if (!res.ok) {
    return NextResponse.json(
      { ok: false, note: 'status file not found', status: res.status, url },
      { status: 404 }
    );
  }
  const json = await res.json();
  return NextResponse.json(json, {
    headers: { 'cache-control': 'public, max-age=0, must-revalidate' },
  });
}