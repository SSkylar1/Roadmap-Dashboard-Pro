import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { githubPat, supabaseReadOnlyUrl, openaiKey } = body || {};

    if (typeof githubPat !== "string" || typeof supabaseReadOnlyUrl !== "string" || typeof openaiKey !== "string") {
      return NextResponse.json({ error: "invalid payload" }, { status: 400 });
    }

    // Placeholder: persistence will be implemented with secure storage.
    // For now, the client stores secrets in localStorage.
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: "unable to parse request" }, { status: 400 });
  }
}
