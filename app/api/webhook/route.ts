import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

function ok(sig: string | null, body: string, secret: string) {
  if (!sig || !secret) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
  try { return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig)); }
  catch { return false; }
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const sig = req.headers.get('x-hub-signature-256');
  const secret = process.env.GITHUB_WEBHOOK_SECRET ?? '';
  if (!ok(sig, raw, secret)) return NextResponse.json({ ok: false }, { status: 401 });

  const event = req.headers.get('x-github-event') ?? 'unknown';
  if (event === 'ping') return NextResponse.json({ ok: true, ping: true });
  // handle "push" etc. — you might purge caches or trigger revalidation
  return NextResponse.json({ ok: true });
}

