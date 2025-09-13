import { NextResponse } from 'next/server';

function svgBadge(label: string, value: string) {
  // very simple badge (left label, right value)
  const left = label || 'roadmap';
  const right = value || '0%';
  return `<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" width="170" height="20" role="img" aria-label="${left}: ${right}">
  <linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>
  <mask id="m"><rect width="170" height="20" rx="3" fill="#fff"/></mask>
  <g mask="url(#m)">
    <rect width="90" height="20" fill="#555"/>
    <rect x="90" width="80" height="20" fill="#007ec6"/>
    <rect width="170" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
    <text x="45" y="14">${left}</text>
    <text x="130" y="14">${right}</text>
  </g>
</svg>`;
}

export async function GET(
  req: Request,
  { params }: { params: { owner: string; repo: string } }
) {
  const { searchParams } = new URL(req.url);
  const label = searchParams.get('label') ?? 'roadmap';

  // Pull the JSON status and derive a percent (fallback 0%)
  const url = `https://roadmapdashboard-dpb0khj20-skylar-swallows-projects.vercel.app/api/status/${params.owner}/${params.repo}`;
  const res = await fetch(url, { cache: 'no-store' });
  let percent = '0%';
  if (res.ok) {
    try {
      const data = await res.json();
      // Adjust this to your JSON schema; common key is data.progress or data.percent
      const raw = (data.progress ?? data.percent ?? data.completion ?? 0) as number;
      percent = `${Math.round(Number(raw))}%`;
    } catch { /* ignore */ }
  }

  const svg = svgBadge(label, percent);
  return new NextResponse(svg, {
    headers: { 'content-type': 'image/svg+xml', 'cache-control': 'no-cache' },
  });
}