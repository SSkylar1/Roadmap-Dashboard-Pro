import { NextResponse } from "next/server";

import { getFileRaw, putFile } from "@/lib/github";
import { describeProjectFile, normalizeProjectKey, projectAwarePath } from "@/lib/project-paths";

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

    const requiredBootstrapFiles: Array<{ raw: string; resolved: string }> = [
      { raw: ".roadmaprc.json", resolved: ".roadmaprc.json" },
      {
        raw: ".github/workflows/roadmap.yml",
        resolved: projectAwarePath(".github/workflows/roadmap.yml", projectKey),
      },
      { raw: "scripts/roadmap-check.mjs", resolved: "scripts/roadmap-check.mjs" },
    ];

    const missingBootstrapFiles: string[] = [];
    await Promise.all(
      requiredBootstrapFiles.map(async ({ raw, resolved }) => {
        const existing = await getFileRaw(owner, repo, resolved, branch, token);
        if (existing === null) {
          missingBootstrapFiles.push(describeProjectFile(raw, projectKey));
        }
      }),
    );

    if (missingBootstrapFiles.length > 0) {
      missingBootstrapFiles.sort((a, b) => a.localeCompare(b));
      const missingList = missingBootstrapFiles.join(", ");
      return NextResponse.json(
        {
          ok: false,
          error: "Complete roadmap setup",
          detail:
            "Run the roadmap setup wizard to add " +
            missingList +
            " before committing from the concept workspace.",
          missing: missingBootstrapFiles,
          setupUrl: "/new",
          code: "missing_roadmap_setup",
        },
        { status: 400 },
      );
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
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message ?? "Failed to commit roadmap" }, { status: 500 });
  }
}
