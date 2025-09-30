export const runtime = "nodejs";
export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";

const H = () => ({
  "User-Agent": "roadmap-dashboard-pro",
  "Authorization": `token ${process.env.GITHUB_TOKEN ?? ""}`,
  "Accept": "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
});

async function tap(url: string) {
  try {
    const r = await fetch(url, { headers: H(), cache: "no-store" });
    const text = await r.text();
    return {
      url,
      status: r.status,
      ok: r.ok,
      snippet: text.slice(0, 200), // show a hint like "SAML SSO enforcement" / "Bad credentials"
    };
  } catch (e: any) {
    return { url, error: String(e?.message || e) };
  }
}

export async function GET() {
  const checks = await Promise.all([
    tap("https://api.github.com/rate_limit"),
    tap("https://api.github.com/user"), // may fail for fine-grained, still useful error text
    tap("https://api.github.com/repos/SSkylar1/You_First"), // adjust if needed
  ]);
  const anyOk = checks.some(c => (c as any).ok);
  return NextResponse.json(
    { ok: anyOk, token_len: (process.env.GITHUB_TOKEN || "").length, checks },
    { headers: { "cache-control": "no-store" } }
  );
}
