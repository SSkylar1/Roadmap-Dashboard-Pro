// app/api/discover/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import micromatch from "micromatch";
import yaml from "js-yaml";

import { getFileRaw, listRepoTreePaths, putFile } from "@/lib/github";
import { describeProjectFile, normalizeProjectKey, projectAwarePath } from "@/lib/project-paths";
import { probeReadOnlyCheck } from "@/lib/read-only-probe";

const READ_ONLY_CHECKS_URL = process.env.READ_ONLY_CHECKS_URL || "";

const DEFAULT_DB_QUERIES = ["ext:pgcrypto"];
const DEFAULT_CODE_GLOBS = ["src/screens/**/*.{tsx,ts}"];
const DEFAULT_DISCOVER_YAML = `# docs/discover.yml
# Customize these queries and code globs to surface completed work
# that never landed on your roadmap.
db_queries:
  - ext:pgcrypto
code_globs:
  - src/screens/**/*.{tsx,ts}
`;

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
  project?: string;
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

  const results = await Promise.all(
    queries.map(async (q) => {
      try {
        const outcome = await probeReadOnlyCheck(url, q);
        if (outcome.ok) {
          return { q, ok: true } as ProbeResult;
        }

        const parts: string[] = [];
        if (outcome.status) parts.push(String(outcome.status));
        if (outcome.why) parts.push(outcome.why);
        const why = parts.join(" ").trim() || undefined;
        return { q, ok: false, why } as ProbeResult;
      } catch (error: any) {
        return { q, ok: false, why: error?.message || String(error) } as ProbeResult;
      }
    }),
  );

  return results;
}

function parseDiscoverConfig(raw: string | null, pathLabel: string): DiscoverConfig {
  const notes: string[] = [];

  if (!raw) {
    notes.push(`${pathLabel} not found — using defaults`);
    return { db_queries: DEFAULT_DB_QUERIES, code_globs: DEFAULT_CODE_GLOBS, notes };
  }

  try {
    const parsed = yaml.load(raw) as any;
    const dbQueries = ensureStringList(parsed?.db_queries ?? parsed?.dbQueries, DEFAULT_DB_QUERIES);
    const codeGlobs = ensureStringList(parsed?.code_globs ?? parsed?.codeGlobs, DEFAULT_CODE_GLOBS);
    return { db_queries: dbQueries, code_globs: codeGlobs, notes };
  } catch (error: any) {
    notes.push(`Failed to parse ${pathLabel} (${error?.message || String(error)})`);
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

function backlogYaml(items: BacklogItem[], configPath: string) {
  if (!items.length) {
    return [
      `# Auto-discovered items generated from ${configPath}`,
      "# (none detected)",
      "",
    ].join("\n");
  }

  return [
    `# Auto-discovered items generated from ${configPath}`,
    ...items.map((item) => `- id: ${item.id}\n  title: "${item.title.replace(/"/g, '\\"')}"\n  status: complete`),
    "",
  ].join("\n");
}

function buildSummary(details: DiscoverSummary) {
  const { owner, repo, branch, project, config, dbSuccesses, dbFailures, matchedPaths, discovered } = details;
  const lines: string[] = [
    `Repo: ${owner}/${repo}`,
    ...(project ? [`Project: ${project}`] : []),
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
  failures: string[],
  token?: string,
) {
  try {
    await putFile(owner, repo, path, content, branch, message, token);
    wrote.push(path);
  } catch (error: any) {
    const detail = error?.message || String(error);
    wrote.push(`${path} (FAILED: ${detail})`);
    failures.push(`${path}: ${detail}`);
  }
}

export async function POST(req: NextRequest) {
  try {
    const payload = await req.json();
    const owner = typeof payload?.owner === "string" ? payload.owner.trim() : "";
    const repo = typeof payload?.repo === "string" ? payload.repo.trim() : "";
    const branch = typeof payload?.branch === "string" && payload.branch.trim() ? payload.branch.trim() : "main";
    const probeUrl = typeof payload?.probeUrl === "string" ? payload.probeUrl : undefined;
    const projectKey = normalizeProjectKey(payload?.project);
    const token = req.headers.get("x-github-pat")?.trim() || undefined;
    if (!owner || !repo) {
      return NextResponse.json({ error: "missing owner/repo" }, { status: 400 });
    }

    const wrote: string[] = [];
    const failures: string[] = [];

    const statusRaw = await getFileRaw(
      owner,
      repo,
      projectAwarePath("docs/roadmap-status.json", projectKey),
      branch,
      token,
    ).catch(() => null);
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

    const discoverPath = projectAwarePath("docs/discover.yml", projectKey);
    const discoverLabel = describeProjectFile("docs/discover.yml", projectKey);
    const discoverRaw = await getFileRaw(owner, repo, discoverPath, branch, token).catch(() => null);
    const missingDiscover = !discoverRaw;
    const config = parseDiscoverConfig(discoverRaw, discoverLabel);

    if (missingDiscover) {
      await safePut(
        owner,
        repo,
        branch,
        discoverPath,
        DEFAULT_DISCOVER_YAML,
        projectKey
          ? `chore(${projectKey}): seed discover config [skip ci]`
          : "chore(roadmap): seed discover config [skip ci]",
        wrote,
        failures,
        token,
      );
      config.notes.push(
        `Seeded ${describeProjectFile("docs/discover.yml", projectKey)} with default discovery settings. Update this file to refine probes.`,
      );
    }

    const dbResults = await probeSupabase(config.db_queries, probeUrl);
    const dbSuccesses = dbResults.filter((result) => result.ok).map((result) => result.q);
    const dbFailures = dbResults.filter((result) => !result.ok);

    const treePaths = await listRepoTreePaths(owner, repo, branch, token);
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

    const backlogPath = projectAwarePath("docs/backlog-discovered.yml", projectKey);
    await safePut(
      owner,
      repo,
      branch,
      backlogPath,
      backlogYaml(discovered, discoverLabel),
      projectKey
        ? `chore(${projectKey}): update backlog-discovered [skip ci]`
        : "chore(roadmap): update backlog-discovered [skip ci]",
      wrote,
      failures,
      token,
    );

    const summary = buildSummary({
      owner,
      repo,
      branch,
      project: projectKey || undefined,
      config,
      dbSuccesses,
      dbFailures,
      matchedPaths,
      discovered,
    });

    const summaryPath = projectAwarePath("docs/summary.txt", projectKey);
    await safePut(
      owner,
      repo,
      branch,
      summaryPath,
      summary,
      projectKey ? `chore(${projectKey}): update summary [skip ci]` : "chore(roadmap): update summary [skip ci]",
      wrote,
      failures,
      token,
    );

    const ok = failures.length === 0;
    if (!ok) {
      config.notes.push(
        ...failures.map(
          (failure) => `GitHub write failed: ${failure}. Ensure the dashboard has push access to ${owner}/${repo}.`,
        ),
      );
    }
    const detail =
      failures.length > 0
        ? `Some files could not be written to GitHub. Check your token permissions and branch settings.\n${failures.join("\n")}`
        : undefined;

    return NextResponse.json(
      {
        ok,
        discovered: discovered.length,
        items: discovered,
        wrote,
        config,
        db: dbResults,
        code_matches: matchedPaths,
        ...(detail ? { error: "GitHub writes failed", detail } : {}),
      },
      {
        status: ok ? 200 : 207,
        headers: { "cache-control": "no-store" },
      },
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
