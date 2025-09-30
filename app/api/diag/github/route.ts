export const runtime = "nodejs";
export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";

const headers = () => ({
  "User-Agent": "roadmap-dashboard-pro",
  "Authorization": `token ${process.env.GITHUB_TOKEN ?? ""}`,
  "Accept": "application/vnd.github+json",
});

export async function GET() {
  try {
    // 1. Rate limit endpoint (works with any valid token)
    const rate = await fetch("https://api.github.com/rate_limit", { headers: headers(), cache: "no-store" });
    const rate_ok = rate.ok;

    // 2. Probe one repo you need access to
    const repo = await fetch("https://api.github.com/repos/SSkylar1/You_First", { headers: headers(), cache: "no-store" });
    const repo_ok = repo.ok;

    return NextResponse.json(
      {
        ok: rate_ok || repo_ok,
        rate_limit_ok: rate_ok,
        repo_probe_ok: repo_ok,
        repo_probe_status: repo.status,
      },
      { headers: { "cache-control": "no-store" } }
    );
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 200 });
  }
}
