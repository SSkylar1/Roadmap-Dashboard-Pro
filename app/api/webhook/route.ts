import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";

const SECRET = process.env.GITHUB_WEBHOOK_SECRET || "";

function verifySignature(raw: string, sig256: string) {
  if (!SECRET) return false;
  const hmac = crypto.createHmac('sha256', SECRET);
  const digest = `sha256=${hmac.update(raw).digest('hex')}`;
  return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(sig256 || ''));
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const sig = req.headers.get('x-hub-signature-256') || '';
  if (!verifySignature(raw, sig)) return new Response('Invalid signature', { status: 401 });
  // TODO: parse event & owner/repo; optionally revalidate cache
  return NextResponse.json({ ok: true });
}
