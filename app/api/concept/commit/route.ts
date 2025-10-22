import { NextResponse } from "next/server";

import { getFileRaw, putFile } from "@/lib/github";
import { describeProjectFile, normalizeProjectKey, projectAwarePath } from "@/lib/project-paths";
import { ROADMAP_CHECKER_SNIPPET } from "@/lib/roadmap-snippets";

const DEFAULT_ROADMAPRC_CONTENT =
  JSON.stringify(
    {
      $schema: "./schema/roadmaprc.schema.json",
      kitVersion: "0.1.1",
      envs: {
        dev: {
          READ_ONLY_CHECKS_URL: "https://example.com/read_only_checks",
        },
      },
      verify: {
        symbols: ["ext:pgcrypto"],
        defaultEnv: "dev",
      },
      comment: {
        liveProbe: true,
        probeTestPass: false,
        probeSupaFn: false,
        privacyDisclaimer: "🔒 Read-only checks.",
        legendEnabled: true,
      },
    },
    null,
    2,
  ) + "\n";

const DEFAULT_ROADMAP_WORKFLOW =
  [
    "name: Roadmap Sync",
    "on:",
    "  push: { branches: [main] }",
    "  pull_request: {}",
    "  workflow_dispatch: {}",
    "jobs:",
    "  sync:",
    "    runs-on: ubuntu-latest",
    "    permissions: { contents: write }",
    "    env:",
    "      ROADMAP_ENV: dev",
    "    steps:",
    "      - uses: actions/checkout@v4",
    "      - uses: actions/setup-node@v4",
    "        with: { node-version: '20' }",
    "      - name: Install dependencies",
    "        run: npm ci",
    "      - name: Run roadmap checks",
    "        env:",
    "          READ_ONLY_CHECKS_URL: ${{ secrets.READ_ONLY_CHECKS_URL }}",
    "        run: npm run roadmap:check",
    "",
  ].join("\n");

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const url = new URL(req.url);
    const asPR = url.searchParams.get("asPR") === "true";
    const body = await req.json();
    const owner = typeof body?.owner === "string" ? body.owner.trim() : "";
    const repo = typeof body?.repo === "string" ? body.repo.trim() : "";
    const branch = typeof body?.branch === "string" && body.branch.trim() ? body.branch.trim() : "main";
    const content = typeof body?.content === "string" ? body.content : "";
    const projectInput = typeof body?.project === "string" ? body.project : "";
    const projectKey = normalizeProjectKey(projectInput);
    const token = req.headers.get("x-github-pat")?.trim() || undefined;

    if (!owner || !repo) {
      return NextResponse.json({ error: "owner and repo are required" }, { status: 400 });
    }

    if (!content.trim()) {
      return NextResponse.json({ error: "Roadmap content is empty" }, { status: 400 });
    }

    const targetPath = projectAwarePath("docs/roadmap.yml", projectKey);

    const bootstrapTargets: Array<{
      raw: string;
      resolved: string;
      content: string;
      message: string;
    }> = [
      {
        raw: ".roadmaprc.json",
        resolved: ".roadmaprc.json",
        content: DEFAULT_ROADMAPRC_CONTENT,
        message: "chore(roadmap): add .roadmaprc.json",
      },
      {
        raw: ".github/workflows/roadmap.yml",
        resolved: projectAwarePath(".github/workflows/roadmap.yml", projectKey),
        content: `${DEFAULT_ROADMAP_WORKFLOW}`,
        message: `chore(roadmap): add ${describeProjectFile(".github/workflows/roadmap.yml", projectKey)}`,
      },
      {
        raw: "scripts/roadmap-check.mjs",
        resolved: "scripts/roadmap-check.mjs",
        content: `${ROADMAP_CHECKER_SNIPPET}\n`,
        message: "chore(roadmap): add roadmap checker script",
      },
    ];

    const bootstrapped: string[] = [];

    for (const target of bootstrapTargets) {
      const existing = await getFileRaw(owner, repo, target.resolved, branch, token);
      if (existing === null) {
        await putFile(owner, repo, target.resolved, target.content, branch, target.message, token);
        bootstrapped.push(describeProjectFile(target.raw, projectKey));
      }
    }

    const message = projectKey
      ? `feat(${projectKey}): add generated ${describeProjectFile("docs/roadmap.yml", projectKey)}`
      : "feat(roadmap): add generated docs/roadmap.yml";
    const result = await putFile(
      owner,
      repo,
      targetPath,
      content,
      branch,
      message,
      token,
      asPR
        ? {
            asPR: true,
            prTitle: message,
            prBody:
              "Generated via Concept to Roadmap wizard. Review the roadmap structure and merge when ready.",
          }
        : undefined,
    );

    return NextResponse.json({
      ok: true,
      branch: result.branch,
      prUrl: result.pullRequest?.html_url ?? result.pullRequest?.url,
      pullRequestNumber: result.pullRequest?.number,
      path: targetPath,
      bootstrapped,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message ?? "Failed to commit roadmap" }, { status: 500 });
  }
}
