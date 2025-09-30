export const runtime = "nodejs";
export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { ghToken } from "@/lib/github";

export async function GET() {
  try {
    const token = await ghToken(); // throws if missing
    const r = await fetch("https://api.github.com/user", {
      headers: { Authorization: `token ${token}`, "User-Agent": "roadmap-dashboard-pro" },
      cache: "no-store",
    });
    const who = await r.json();
    return NextResponse.json({
      ok: r.ok,
      login: who?.login,
      id: who?.id,
      scopes: r.headers.get("x-oauth-scopes")
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
