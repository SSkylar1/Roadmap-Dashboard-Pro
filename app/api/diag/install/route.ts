import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";

function appJwt(): string {
  const appId = process.env.GH_APP_ID!;
  const keyB64 = process.env.GH_APP_PRIVATE_KEY_B64!;
  const pem = Buffer.from(keyB64, "base64").toString("utf8");
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    {
      iat: now - 60,
      exp: now + 9 * 60, // 9 minutes
      iss: appId,
    },
    pem,
    { algorithm: "RS256" }
  );
}

export async function GET(req: NextRequest) {
  const owner = req.nextUrl.searchParams.get("owner")!;
  const repo = req.nextUrl.searchParams.get("repo")!;
  try {
    const r = await fetch(`https://api.github.com/repos/${owner}/${repo}/installation`, {
      headers: {
        Authorization: `Bearer ${appJwt()}`,
        Accept: "application/vnd.github+json",
      },
    });
    const text = await r.text();
    return NextResponse.json(
      { ok: r.ok, status: r.status, owner, repo, body: safeJson(text) },
      { status: 200 }
    );
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 200 });
  }
}

function safeJson(s: string) {
  try { return JSON.parse(s); } catch { return s; }
}
