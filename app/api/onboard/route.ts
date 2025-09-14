import { NextResponse } from "next/server";
import { getTokenForRepo } from "../../../lib/token";
import { upsertFile } from "../../../lib/ghContents";

// Force Node.js runtime (we use Buffer/jose/etc.)
export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const owner  = String(body.owner || "").trim();       // e.g. "SSkylar1"
    const repo   = String(body.repo || "").trim();        // e.g. "Roadmap-Kit-Starter"
    const branch = String(body.branch || "main").trim();  // or "chore/roadmap-setup"

    if (!owner || !repo) {
      return NextResponse.json({ error: "owner and repo are required" }, { status: 400 });
    }

    const roadmapRc = {
      kitVersion: "0.1.1",
      envs: {
        dev:  { READ_ONLY_CHECKS_URL: body.devReadOnlyChecksUrl },
        prod: { READ_ONLY_CHECKS_URL: body.prodReadOnlyChecksUrl || "https://<prod-ref>.functions.supabase.co/read_only_checks" },
      },
      verify: { symbols: ["ext:pgcrypto","table:public:users","rls:public:users"], defaultEnv: "dev" },
      comment: {
        liveProbe: true, probeTestPass: false, probeSupaFn: false,
        privacyDisclaimer: "🔒 Read-only, allow-listed probes. No PII or writes.",
        legendEnabled: true,
      },
    };

    const token = await getTokenForRepo(owner, repo);

    await upsertFile({
      owner, repo, branch, token,
      path: ".roadmaprc.json",
      json: roadmapRc,
    });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 });
  }
}