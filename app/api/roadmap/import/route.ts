import { NextResponse } from "next/server";
import { load } from "js-yaml";

import { getFileRaw, putFile } from "@/lib/github";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const INFRA_FACTS_TEMPLATE = [
  "# Infrastructure facts",
  "",
  "- **Primary environment**: ",
  "- **Database**: ",
  "- **Deployment pipeline**: ",
  "- **Monitoring & alerts**: ",
  "",
  "Add infra constraints, compliance requirements, and escalation paths so the build team ships with confidence.",
  "",
].join("\n");

const TECH_STACK_TEMPLATE = [
  "version: 1",
  "stack:",
  "  frontend:",
  "    frameworks: []",
  "    libraries: []",
  "  backend:",
  "    languages: []",
  "    services: []",
  "  infrastructure:",
  "    platforms: []",
  "    observability: []",
  "integrations: []",
  "notes: []",
  "",
].join("\n");

const ROADMAP_WORKFLOW_TEMPLATE = [
  "name: Roadmap checks",
  "on:",
  "  push:",
  "    branches: [main]",
  "  pull_request:",
  "jobs:",
  "  roadmap:",
  "    runs-on: ubuntu-latest",
  "    steps:",
  "      - uses: actions/checkout@v4",
  "      - uses: actions/setup-node@v4",
  "        with:",
  "          node-version: 20",
  "      - run: npm ci",
  "      - run: npm run roadmap:check",
  "        env:",
  "          READ_ONLY_CHECKS_URL: ${{ secrets.READ_ONLY_CHECKS_URL }}",
  "",
].join("\n");

type ImportRequestBody = {
  owner?: string;
  repo?: string;
  branch?: string;
  roadmap?: string;
};

type ImportSuccess = {
  ok: true;
  created: string[];
  skipped: string[];
  branch?: string;
  prUrl?: string;
  pullRequestNumber?: number;
};

type ImportError = {
  error: string;
  detail?: string;
  prUrl?: string;
};

export async function POST(req: Request) {
  let body: ImportRequestBody;
  try {
    body = (await req.json()) as ImportRequestBody;
  } catch (error) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const url = new URL(req.url);
  const asPR = url.searchParams.get("asPR") === "true";
  const owner = typeof body?.owner === "string" ? body.owner.trim() : "";
  const repo = typeof body?.repo === "string" ? body.repo.trim() : "";
  const branch = typeof body?.branch === "string" && body.branch.trim() ? body.branch.trim() : "main";
  const roadmap = typeof body?.roadmap === "string" ? body.roadmap : "";
  const token = req.headers.get("x-github-pat")?.trim() || undefined;

  if (!owner || !repo) {
    return NextResponse.json({ error: "owner and repo are required" }, { status: 400 });
  }

  if (!roadmap.trim()) {
    return NextResponse.json({ error: "Roadmap file is empty" }, { status: 400 });
  }

  try {
    const parsed = load(roadmap);
    if (!parsed || typeof parsed !== "object") {
      return NextResponse.json({ error: "docs/roadmap.yml must parse into an object" }, { status: 400 });
    }
  } catch (error: any) {
    return NextResponse.json(
      { error: "Failed to parse roadmap.yml", detail: error?.message ?? String(error) },
      { status: 400 },
    );
  }

  const created: string[] = [];
  const skipped: string[] = [];

  try {
    const message = "feat(roadmap): import roadmap definition";
    const result = await putFile(
      owner,
      repo,
      "docs/roadmap.yml",
      roadmap,
      branch,
      message,
      token,
      asPR
        ? {
            asPR: true,
            prTitle: message,
            prBody: "Seeded via Roadmap Ready workspace.",
          }
        : undefined,
    );
    created.push("docs/roadmap.yml");

    const workingBranch = asPR ? result.branch : branch;

    const scaffoldTargets = [
      {
        path: "docs/infra-facts.md",
        content: INFRA_FACTS_TEMPLATE,
        message: "chore(roadmap): scaffold docs/infra-facts.md",
      },
      {
        path: "docs/tech-stack.yml",
        content: TECH_STACK_TEMPLATE,
        message: "chore(roadmap): scaffold docs/tech-stack.yml",
      },
      {
        path: ".github/workflows/roadmap.yml",
        content: ROADMAP_WORKFLOW_TEMPLATE,
        message: "chore(roadmap): add roadmap workflow",
      },
    ] as const;

    for (const target of scaffoldTargets) {
      const existing = await getFileRaw(owner, repo, target.path, workingBranch, token);

      if (existing !== null) {
        skipped.push(target.path);
        continue;
      }

      await putFile(owner, repo, target.path, target.content, workingBranch, target.message, token);
      created.push(target.path);
    }

    const response: ImportSuccess = {
      ok: true,
      created,
      skipped,
      branch: workingBranch,
      prUrl: result.pullRequest?.html_url ?? result.pullRequest?.url,
      pullRequestNumber: result.pullRequest?.number,
    };
    return NextResponse.json(response);
  } catch (error: any) {
    const payload: ImportError = {
      error: error?.message ?? "Failed to import roadmap",
    };
    return NextResponse.json(payload, { status: 500 });
  }
}
