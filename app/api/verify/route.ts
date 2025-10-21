import { NextRequest, NextResponse } from "next/server";

import { parseProbeHeaders, probeReadOnlyCheck } from "@/lib/read-only-probe";

const READ_ONLY_CHECKS_URL = process.env.READ_ONLY_CHECKS_URL || "";
const ENV_PROBE_HEADERS = parseProbeHeaders(process.env.READ_ONLY_CHECKS_HEADERS);
const allowed = /^(ext:[a-z0-9_]+|table:[a-z0-9_]+:[a-z0-9_]+|rls:[a-z0-9_]+:[a-z0-9_]+|policy:[a-z0-9_]+:[a-z0-9_]+:[a-z0-9_]+)$/;

export async function POST(req: NextRequest) {
  const payload = await req.json();
  const query = typeof payload?.query === "string" ? payload.query : undefined;
  if (typeof query !== "string" || !allowed.test(query)) {
    return NextResponse.json({ ok: false, error: "invalid symbol" }, { status: 400 });
  }
  if (!READ_ONLY_CHECKS_URL) return NextResponse.json({ ok: false, error: "READ_ONLY_CHECKS_URL not set" }, { status: 500 });
  const rawRequestProbeHeaders =
    req.headers.get("x-supabase-headers") ??
    req.headers.get("x-probe-headers") ??
    req.headers.get("x-discovery-headers");
  const requestProbeHeaders = parseProbeHeaders(rawRequestProbeHeaders);
  const payloadProbeHeaders = parseProbeHeaders(
    payload?.probeHeaders ??
      payload?.probe_headers ??
      payload?.supabaseHeaders ??
      payload?.supabase_headers ??
      payload?.headers
  );
  const probeHeaders = {
    ...ENV_PROBE_HEADERS,
    ...requestProbeHeaders,
    ...payloadProbeHeaders,
  };

  const outcome = await probeReadOnlyCheck(READ_ONLY_CHECKS_URL, query, probeHeaders);
  if (outcome.ok) {
    return NextResponse.json({ ok: true });
  }

  const detailParts: string[] = [];
  if (typeof outcome.status === "number") detailParts.push(`HTTP ${outcome.status}`);
  if (outcome.why) {
    const trimmed = outcome.why.trim();
    if (trimmed) detailParts.push(trimmed.slice(0, 200));
  }
  const error = detailParts.join(" — ") || "Unexpected read_only_checks response";

  return NextResponse.json(
    {
      ok: false,
      error,
      ...(typeof outcome.status === "number" ? { status: outcome.status } : {}),
    },
    { status: 200 }
  );
}
