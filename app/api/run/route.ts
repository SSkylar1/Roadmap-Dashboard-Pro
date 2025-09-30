// app/api/run/route.ts
// Node runtime + no caching to ensure commits always reflect current state
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import yaml from "js-yaml";
import { getFileRaw, putFile } from "@/lib/github";

type Check = {
  type: "files_exist" | "http_ok" | "sql_exists";
  globs?: string[];
  url?: string;
  must_match?: string[];
  query?: string;
};

async function files_exist(owner: string, repo: string, globs: string[], ref?: string) {
  for (const p of globs) {
    const raw = await getFileRaw(owner, repo, p, ref).catch(() => null);
    if (raw === null) return { ok: false };
  }
  return { ok: true };
}

async function http_ok(url: string, must_match: string[] = []) {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) return { ok: false, code: r.status };
  const t = await r.text();
  const ok = must_match.every((m) => t.includes(m));
  return { ok, code: r.status };
}

async function sql_exists(probeUrl: string, query: string) {
  const r = await fetch(probeUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ queries: [query] }),
  });
  if (!r.ok) return { ok: false, code: r.status };
  const j = await r.json();
  const res = Array.isArray(j.results) ? j.results[0] : null;
  return { ok: !!res?.ok };
}

export async function POST(req: NextRequest) {
  try {
    const { owner, repo, branch = "main", probeUrl } = await req.json();
    if (!owner || !repo) {
      return NextResponse.json({ error: "missing owner/repo" }, { status: 400 });
    }

    // Load roadmap spec
    const rmRaw = await getFileRaw(owner, repo, "docs/roadmap.yml", branch);
    if (rmRaw === null) {
      return NextResponse.json({ error: "docs/roadmap.yml missing" }, { status: 404 });
    }
    const rm: any = yaml.load(rmRaw);

    // Execute checks
    const status: any = { generated_at: new Date().toISOString(), owner, repo, branch, weeks: [] as any[] };
    for (const w of rm.weeks ?? []) {
      const W: any = { id: w.id, title: w.title, items: [] as any[] };
      for (const it of w.items ?? []) {
        let passed = true;
        const results: any[] = [];
        for (const c of (it.checks as Check[]) ?? []) {
          let r;
          if (c.type === "files_exist") r = await files_exist(owner, repo, c.globs || [], branch);
          else if (c.type === "http_ok") r = await http_ok(c.url!, c.must_match || []);
          else if (c.type === "sql_exists") {
            if (!probeUrl) r = { ok: false, error: "probeUrl not provided" };
            else r = await sql_exists(probeUrl, c.query!);
          } else r = { ok: false, error: "unknown check" };
          results.push({ ...c, ...r });
          if (!r.ok) passed = false;
        }
        W.items.push({ id: it.id, name: it.name, done: passed, results });
      }
      status.weeks.push(W);
    }

    // Commit artifacts (write both root docs/* and legacy docs/roadmap/*)
    const pretty = JSON.stringify(status, null, 2);
    const wrote: string[] = [];

    async function safePut(p: string, content: string, msg: string) {
      try {
        await putFile(owner, repo, p, content, branch, msg);
        wrote.push(p);
      } catch (e: any) {
        wrote.push(`${p} (FAILED: ${e?.message || e})`);
      }
    }

    // 1) machine artifact(s)
    await safePut("docs/roadmap-status.json", pretty, "chore(roadmap): update status [skip ci]");
    await safePut("docs/roadmap/roadmap-status.json", pretty, "chore(roadmap): mirror status [skip ci]");

    // 2) human-readable plan
    let plan = `# Project Plan\nGenerated: ${status.generated_at}\n\n`;
    for (const w of status.weeks) {
      plan += `## ${w.title}\n\n`;
      for (const it of w.items) plan += `${it.done ? "✅" : "❌"} **${it.name}** (${it.id})\n`;
      plan += `\n`;
    }
    await safePut("docs/project-plan.md", plan, "chore(roadmap): update plan [skip ci]");
    await safePut("docs/roadmap/project-plan.md", plan, "chore(roadmap): update plan [skip ci]");

    return NextResponse.json({ ok: true, wrote }, { headers: { "cache-control": "no-store" } });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}