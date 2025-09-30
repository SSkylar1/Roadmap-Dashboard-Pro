export const runtime = "nodejs";
export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";

const H = () => ({
  "User-Agent": "roadmap-dashboard-pro",
  "Authorization": `token ${process.env.GITHUB_TOKEN ?? ""}`,
  "Accept": "application/vnd.github+json",
});

export async function GET() {
  try {
    // Validate token without needing user scope
    const r1 = await fetch("https://api.github.com/rate_limit", { headers: H(), cache: "no-store" });
    const ok1 = r1.ok;

    // Probe a repo you care about (adjust if needed)
    const r2 = await fetch("https://api.github.com/repos/SSkylar1/You_First", { headers: H(), cache: "no-store" });
    const ok2 = r2.ok;

    return NextResponse.json(
      { ok: ok1 || ok2, rate_limit_ok: ok1, repo_probe_ok: ok2, repo_probe_status: r2.status },
      { headers: { "cache-control": "no-store" } }
    );
  } catch (e:any) {
    return NextResponse.json({ ok:false, error: String(e?.message || e) }, { status: 200 });
  }
}
