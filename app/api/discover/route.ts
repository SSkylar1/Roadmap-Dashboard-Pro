// app/api/discover/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import micromatch from "micromatch";
import yaml from "js-yaml";

import { getFileRaw, listRepoTree, putFile } from "@/lib/github";

const READ_ONLY_CHECKS_URL = process.env.READ_ONLY_CHECKS_URL || "";

const DEFAULT_DB_QUERIES = ["ext:pgcrypto"];
const DEFAULT_CODE_GLOBS = ["src/screens/**/*.{tsx,ts}"];

type ProbeResult = { q: string; ok: boolean; why?: string };
type DiscoverConfig = {
  db_queries: string[];
  code_globs: string[];
  notes: string[];
};

type BacklogItem = { id: string; title: string; status: "complete" };

type DiscoverSummary = {
  owner: string;
  repo: string;
  branch: string;
  config: DiscoverConfig;
  dbSuccesses: string[];
  dbFailures: ProbeResult[];
  matchedPaths: string[];
  discovered: BacklogItem[];
};

function ensureStringList(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  const filtered = value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0);
  return filtered.length ? filtered : fallback;
}

async function probeSupabase(queries: string[], overrideUrl?: string): Promise<ProbeResult[]> {
  const url = overrideUrl?.trim() || READ_ONLY_CHECKS_URL;
  if (!url) {
    return queries.map((q) => ({ q, ok: false, why: "READ_ONLY_CHECKS_URL not configured" }));
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ queries }),
    });

    if (!response.ok) {
      return queries.map((q) => ({ q, ok: false, why: String(response.status) }));
    }

    const json = await response.json().catch(() => ({}));
    const arr = Array.isArray(json?.results) ? json.results : [];
    const byQuery = new Map(arr.map((entry: any) => [entry?.q, !!entry?.ok]));
    return queries.map((q) => ({ q, ok: !!byQuery.get(q) }));
  } catch (error: any) {
    return queries.map((q) => ({ q, ok: false, why: error?.message || String(error) }));
  }
}

function parseDiscoverConfig(raw: string | null): DiscoverConfig {
  const notes: string[] = [];

  if (!raw) {
    notes.push("docs/discover.yml not found — using defaults");
    return { db_queries: DEFAULT_DB_QUERIES, code_globs: DEFAULT_CODE_GLOBS, notes };
  }

  try {
    const parsed = yaml.load(raw) as any;
    const dbQueries = ensureStringList(parsed?.db_queries ?? parsed?.dbQueries, DEFAULT_DB_QUERIES);
    const codeGlobs = ensureStringList(parsed?.code_globs ?? parsed?.codeGlobs, DEFAULT_CODE_GLOBS);
    return { db_queries: dbQueries, code_globs: codeGlobs, notes };
  } catch (error: any) {
    notes.push(`Failed to parse docs/discover.yml (${error?.message || String(error)})`);
    return { db_queries: DEFAULT_DB_QUERIES, code_globs: DEFAULT_CODE_GLOBS, notes };
  }
}

function slugify(input: string) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "item";
}

function backlogYaml(items: BacklogItem[]) {
  if (!items.length) {
    return [
      "# Auto-discovered items generated from docs/discover.yml",
      "# (none detected)",
      "",
    ].join("\n");
  }

  return [
    "# Auto-discovered items generated from docs/discover.yml",
    ...items.map((item) => `- id: ${item.id}\n  title: "${item.title.replace(/"/g, '\\"')}"\n  status: complete`),
    "",
  ].join("\n");
}

function buildSummary(details: DiscoverSummary) {
  const { owner, repo, branch, config, dbSuccesses, dbFailures, matchedPaths, discovered } = details;
  const lines: string[] = [
    `Repo: ${owner}/${repo}`,
    `Branch: ${branch}`,
    `Generated: ${new Date().toISOString()}`,
    "",
    "Discovery configuration:",
    `- db_queries (${config.db_queries.length}): ${config.db_queries.join(", ") || "(none)"}`,
    `- code_globs (${config.code_globs.length}): ${config.code_globs.join(", ") || "(none)"}`,
  ];

  if (config.notes.length) {
    lines.push("", "Notes:", ...config.notes.map((note) => `- ${note}`));
  }

  lines.push(
    "",
    `Successful database probes (${dbSuccesses.length}):`,
    dbSuccesses.length ? dbSuccesses.map((q) => `- ${q}`).join("\n") : "- none",
    "",
    `Failed database probes (${dbFailures.length}):`,
    dbFailures.length ? dbFailures.map((r) => `- ${r.q}${r.why ? ` → ${r.why}` : ""}`).join("\n") : "- none",
    "",
    `Matched code paths (${matchedPaths.length}):`,
    matchedPaths.length ? matchedPaths.map((path) => `- ${path}`).join("\n") : "- none",
    "",
    `Newly discovered backlog items (${discovered.length}):`,
    discovered.length ? discovered.map((item) => `- ${item.title}`).join("\n") : "- none",
    "",
  );

  return lines.join("\n");
}

function alreadyTrackedFactory(doneNames: Set<string>) {
  const comparisons = Array.from(doneNames)
    .map((name) => name.toLowerCase())
    .filter(Boolean);

  return (title: string) => {
    const lower = title.toLowerCase();
    return comparisons.some((name) => lower === name || lower.includes(name));
  };
}

async function safePut(
  owner: string,
  repo: string,
  branch: string,
  path: string,
  content: string,
  message: string,
  wrote: string[],
) {
  try {
    await putFile(owner, repo, path, content, branch, message);
    wrote.push(path);
  } catch (error: any) {
    wrote.push(`${path} (FAILED: ${error?.message || String(error)})`);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { owner, repo, branch = "main", probeUrl } = await req.json();
    if (!owner || !repo) {
      return NextResponse.json({ error: "missing owner/repo" }, { status: 400 });
    }

    const statusRaw = await getFileRaw(owner, repo, "docs/roadmap-status.json", branch).catch(() => null);
    const doneNames = new Set<string>();
    if (statusRaw) {
      try {
        const parsed = JSON.parse(statusRaw);
        for (const week of parsed?.weeks ?? []) {
          for (const item of week?.items ?? []) {
            if (item?.done && typeof item?.name === "string") {
              doneNames.add(item.name);
            }
          }
        }
      } catch {}
    }

    const discoverRaw = await getFileRaw(owner, repo, "docs/discover.yml", branch).catch(() => null);
    const config = parseDiscoverConfig(discoverRaw);

    const dbResults = await probeSupabase(config.db_queries, probeUrl);
    const dbSuccesses = dbResults.filter((result) => result.ok).map((result) => result.q);
    const dbFailures = dbResults.filter((result) => !result.ok);

    const treePaths = await listRepoTree(owner, repo, branch);
    const matchedPaths = config.code_globs.length
      ? Array.from(new Set(micromatch(treePaths, config.code_globs, { dot: true }))).sort()
      : [];

    const alreadyTracked = alreadyTrackedFactory(doneNames);
    const discovered: BacklogItem[] = [];

    for (const query of dbSuccesses) {
      const title = `Database check present: ${query}`;
      if (!alreadyTracked(title)) {
        discovered.push({ id: slugify(`db-${query}`), title, status: "complete" });
      }
    }

    for (const path of matchedPaths) {
      const title = `Code path matched: ${path}`;
      if (!alreadyTracked(title)) {
        discovered.push({ id: slugify(`code-${path}`), title, status: "complete" });
      }
    }

    const wrote: string[] = [];

    await safePut(
      owner,
      repo,
      branch,
      "docs/backlog-discovered.yml",
      backlogYaml(discovered),
      "chore(roadmap): update backlog-discovered [skip ci]",
      wrote,
    );

    const summary = buildSummary({
      owner,
      repo,
      branch,
      config,
      dbSuccesses,
      dbFailures,
      matchedPaths,
      discovered,
    });

    await safePut(owner, repo, branch, "docs/summary.txt", summary, "chore(roadmap): update summary [skip ci]", wrote);

    return NextResponse.json(
      {
        ok: true,
        discovered: discovered.length,
        items: discovered,
        wrote,
        config,
        db: dbResults,
        code_matches: matchedPaths,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error: any) {
    return NextResponse.json({ error: String(error?.message || error) }, { status: 500 });
  }
}

export async function OPTIONS() {
  return NextResponse.json({ ok: true }, { status: 200 });
}

export async function GET(req: NextRequest) {
  const redirectUrl = new URL("/wizard/midproject/workspace#discover", req.url);
  return NextResponse.redirect(redirectUrl, { status: 307 });
}
