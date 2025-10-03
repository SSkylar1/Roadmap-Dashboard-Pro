import { NextResponse } from "next/server";

import { putFile } from "@/lib/github";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const owner = typeof body?.owner === "string" ? body.owner.trim() : "";
    const repo = typeof body?.repo === "string" ? body.repo.trim() : "";
    const branch = typeof body?.branch === "string" && body.branch.trim() ? body.branch.trim() : "main";
    const content = typeof body?.content === "string" ? body.content : "";

    if (!owner || !repo) {
      return NextResponse.json({ error: "owner and repo are required" }, { status: 400 });
    }

    if (!content.trim()) {
      return NextResponse.json({ error: "Roadmap content is empty" }, { status: 400 });
    }

    await putFile(owner, repo, "docs/roadmap.yml", content, branch, "feat(roadmap): add generated docs/roadmap.yml");

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message ?? "Failed to commit roadmap" }, { status: 500 });
  }
}
