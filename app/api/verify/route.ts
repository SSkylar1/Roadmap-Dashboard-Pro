import { NextRequest, NextResponse } from "next/server";

const READ_ONLY_CHECKS_URL = process.env.READ_ONLY_CHECKS_URL || "";
const allowed = /^(ext:[a-z0-9_]+|table:[a-z0-9_]+:[a-z0-9_]+|rls:[a-z0-9_]+:[a-z0-9_]+|policy:[a-z0-9_]+:[a-z0-9_]+:[a-z0-9_]+)$/;

export async function POST(req: NextRequest) {
  const { query } = await req.json();
  if (typeof query !== "string" || !allowed.test(query)) {
    return NextResponse.json({ ok: false, error: "invalid symbol" }, { status: 400 });
  }
  if (!READ_ONLY_CHECKS_URL) return NextResponse.json({ ok: false, error: "READ_ONLY_CHECKS_URL not set" }, { status: 500 });
  const r = await fetch(READ_ONLY_CHECKS_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query })
  });
  const txt = await r.text();
  try { const j = JSON.parse(txt); return NextResponse.json({ ok: !!j.ok }); }
  catch { return NextResponse.json({ ok: false, error: txt.slice(0, 200) }); }
}
