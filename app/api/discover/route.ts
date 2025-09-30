// app/api/discover/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getFileRaw, putFile } from "@/lib/github";

// --- helpers ---
async function probe(probeUrl: string, queries: string[]) {
  if (!probeUrl) return queries.map(q => ({ q, ok: false, why: "no probeUrl" }));
  const r = await fetch(probeUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ queries })
  });
  if (!r.ok) return queries.map(q => ({ q, ok: false, why: String(r.status) }));
  const j = await r.json().catch(() => ({}));
  const arr = Array.isArray(j.results) ? j.results : [];
  const byQ = new Map(arr.map((x: any) => [x.q, !!x.ok]));
  return queries.map(q => ({ q, ok: !!byQ.get(q) }));
}

async function fileExists(owner: string, repo: string, path: string, ref?: string) {
  // We treat each path as literal (cheap existence check via contents API/raw)
  const raw = await getFileRaw(owner, repo, path, ref).catch(() => null);
  return raw !== null;
}

function yamlList(items: { id: string; title: string; status: "complete" }[]) {
  if (!items.length) {
    return "# Auto-discovered items that appear complete but weren’t on the roadmap\n# (none)\n";
  }
  return (
    ["# Auto-discovered items that appear complete but weren’t on the roadmap"]
      .concat(items.map(x => `- id: ${x.id}\n  title: "${x.title}"\n  status: complete`))
      .join("\n") + "\n"
  );
}

export async function POST(req: NextRequest) {
  try {
    const { owner, repo, branch = "main", probeUrl } = await req.json();
    if (!owner || !repo) {
      return NextResponse.json({ error: "missing owner/repo" }, { status: 400 });
    }

    // 1) Read current status to avoid duplicating already-done items
    const statusRaw = await getFileRaw(owner, repo, "docs/roadmap-status.json", branch).catch(() => null);
    const doneNames = new Set<string>();
    if (statusRaw) {
      try {
        const s = JSON.parse(statusRaw);
        for (const w of s.weeks ?? []) {
          for (const it of w.items ?? []) {
            if (it?.done && typeof it?.name === "string") doneNames.add(it.name);
          }
        }
      } catch {}
    }

    // 2) DB probes (edit this list to fit your schema/policies)
    const dbQueries = [
      "ext:pgcrypto",
      "table:public:profiles",
      "rls:public:profiles",
      // Example policy (rename to match your policy names):
      "policy:public:profiles:select:Profiles can view own"
    ];
    const db = await probe(probeUrl, dbQueries);

    // 3) Code presence checks (add paths that matter for your repos)
    const codePaths = [
      "supabase/functions/read_only_checks/index.ts",
      "src/screens/JournalScreen.tsx",
      "docs/context/context-pack.json",
      "docs/tech-stack.yml"
    ];
    const present: string[] = [];
    for (const p of codePaths) {
      // eslint-disable-next-line no-await-in-loop
      if (await fileExists(owner, repo, p, branch)) present.push(p);
    }

    // 4) Build discovered list, skipping names already “done” in status
    const discovered: { id: string; title: string; status: "complete" }[] = [];

    for (const r of db) {
      if (r.ok) {
        const title = `DB: ${r.q}`;
        if (![...doneNames].some(n => title.includes(n))) {
          discovered.push({ id: r.q.replace(/[^a-zA-Z0-9_-]+/g, "-"), title, status: "complete" });
        }
      }
    }
    for (const p of present) {
      const title = `Code: ${p} present`;
      if (![...doneNames].some(n => title.includes(n))) {
        discovered.push({ id: p.replace(/[^a-zA-Z0-9_-]+/g, "-"), title, status: "complete" });
      }
    }

    // 5) Commit artifacts
    const wrote: string[] = [];
    async function safePut(path: string, content: string, msg: string) {
      try {
        await putFile(owner, repo, path, content, branch, msg);
        wrote.push(path);
      } catch (e: any) {
        wrote.push(`${path} (FAILED: ${e?.message || e})`);
      }
    }

    const backlogBody = yamlList(discovered);
    await safePut("docs/backlog-discovered.yml", backlogBody, "chore(roadmap): update backlog-discovered [skip ci]");

    const summary = `Repo: ${owner}/${repo}
Generated: ${new Date().toISOString()}

Newly discovered, already-done items (not on roadmap):
${discovered.length ? discovered.map(d => `- ${d.title}`).join("\n") : "- none"}
`;
    await safePut("docs/summary.txt", summary, "chore(roadmap): update summary [skip ci]");

    return NextResponse.json({ ok: true, discovered: discovered.length, wrote }, { headers: { "cache-control": "no-store" } });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}