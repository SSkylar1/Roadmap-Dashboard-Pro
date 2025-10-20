import { NextRequest, NextResponse } from "next/server";

import { STANDALONE_MODE } from "@/lib/config";
import { getFileRaw } from "@/lib/github";
import { describeProjectFile, normalizeProjectKey, projectAwarePath } from "@/lib/project-paths";
import {
  deriveStandaloneWorkspaceId,
  getCurrentStandaloneWorkspaceRoadmap,
} from "@/lib/standalone/roadmaps-store";
import { getLatestStandaloneStatusSnapshot } from "@/lib/standalone/status-snapshots";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteParams = { params: { owner: string; repo: string } };

type ContextPackFile = {
  path: string;
  optional?: boolean;
};

const CONTEXT_FILES: ContextPackFile[] = [
  { path: "docs/roadmap.yml" },
  { path: "docs/roadmap-status.json" },
  { path: "docs/tech-stack.yml" },
  { path: "docs/backlog-discovered.yml" },
  { path: "docs/summary.txt" },
  { path: "docs/gtm-plan.md", optional: true },
];

function normalizeBranch(value: string | null): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

export async function GET(req: NextRequest, { params }: RouteParams) {
  const { owner, repo } = params;
  const url = new URL(req.url);
  const branch = normalizeBranch(url.searchParams.get("branch"));
  const projectKey = normalizeProjectKey(url.searchParams.get("project"));

  try {
    if (STANDALONE_MODE) {
      const workspaceId = deriveStandaloneWorkspaceId(owner, repo);
      if (!workspaceId) {
        return NextResponse.json({ error: "invalid_workspace" }, { status: 400 });
      }

      const roadmapRecord = getCurrentStandaloneWorkspaceRoadmap(workspaceId);
      const snapshot = getLatestStandaloneStatusSnapshot(workspaceId, projectKey ?? null, branch ?? null);

      const roadmapPath = describeProjectFile("docs/roadmap.yml", projectKey);
      const statusPath = describeProjectFile("docs/roadmap-status.json", projectKey);
      const techStackPath = describeProjectFile("docs/tech-stack.yml", projectKey);
      const backlogPath = describeProjectFile("docs/backlog-discovered.yml", projectKey);
      const summaryPath = describeProjectFile("docs/summary.txt", projectKey);
      const gtmPlanPath = describeProjectFile("docs/gtm-plan.md", projectKey);

      const files: Record<string, string> = {};

      if (roadmapRecord?.source) {
        files[roadmapPath] = roadmapRecord.source;
      } else {
        files[roadmapPath] = [
          "# Standalone roadmap placeholder",
          "No roadmap has been imported yet.",
          "Paste or upload a roadmap YAML file to populate this export.",
          "",
        ].join("\n");
      }

      if (snapshot?.payload) {
        files[statusPath] = JSON.stringify(snapshot.payload, null, 2);
      } else {
        files[statusPath] = JSON.stringify(
          {
            message: "Standalone mode has not generated a roadmap status snapshot yet.",
            workspace: workspaceId,
            project: projectKey ?? undefined,
            branch: branch ?? undefined,
          },
          null,
          2,
        );
      }

      const stackLines: string[] = [
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
        "notes:",
        "  - Standalone mode placeholder; update after importing real stack data.",
        "",
      ];
      files[techStackPath] = stackLines.join("\n");

      const backlogLines: string[] = [
        `# ${backlogPath}`,
        "# Standalone mode does not auto-discover backlog items.",
        "# Capture follow-ups manually after each status run.",
        "",
      ];
      files[backlogPath] = backlogLines.join("\n");

      const summaryLines: string[] = [
        `Repo: ${owner}/${repo}`,
        `Workspace: ${workspaceId}`,
        `Generated: ${new Date().toISOString()}`,
      ];
      if (projectKey) {
        summaryLines.push(`Project: ${projectKey}`);
      }
      if (branch) {
        summaryLines.push(`Branch: ${branch}`);
      }
      if (roadmapRecord?.title) {
        summaryLines.push(`Roadmap title: ${roadmapRecord.title}`);
      }
      if (roadmapRecord?.status) {
        summaryLines.push("", "Roadmap status counts:");
        const entries = Object.entries(roadmapRecord.status.counts);
        if (entries.length) {
          for (const [statusKey, count] of entries) {
            summaryLines.push(`- ${statusKey}: ${count}`);
          }
        } else {
          summaryLines.push("- No status counts available");
        }
        summaryLines.push(`Total items: ${roadmapRecord.status.total}`);
        if (roadmapRecord.status.problems.length) {
          summaryLines.push("", "Roadmap issues:", ...roadmapRecord.status.problems.map((problem) => `- ${problem}`));
        }
      }
      if (snapshot) {
        summaryLines.push("", `Latest status snapshot captured ${snapshot.created_at}.`);
      } else {
        summaryLines.push("", "No status snapshot captured yet.");
      }
      summaryLines.push("", "Standalone mode keeps this data in memory only.");
      files[summaryPath] = summaryLines.join("\n");

      files[gtmPlanPath] = [
        "# Go-to-market plan placeholder",
        "Standalone mode has not generated a GTM plan for this workspace yet.",
        "Document launch milestones here once you export a plan.",
        "",
      ].join("\n");

      const responsePayload = {
        generated_at: new Date().toISOString(),
        source: "standalone" as const,
        repo: {
          owner,
          name: repo,
          branch: branch ?? "HEAD",
          project: projectKey || undefined,
        },
        files,
      };

      return NextResponse.json(responsePayload, { headers: { "cache-control": "no-store" } });
    }

    const token = req.headers.get("x-github-pat")?.trim() || undefined;

    const entries = await Promise.all(
      CONTEXT_FILES.map(async (file) => ({
        path: describeProjectFile(file.path, projectKey),
        optional: file.optional ?? false,
        content: await getFileRaw(owner, repo, projectAwarePath(file.path, projectKey), branch, token),
      })),
    );

    const missing = entries
      .filter((entry) => !entry.optional && entry.content === null)
      .map((entry) => entry.path);

    if (missing.length > 0) {
      return NextResponse.json(
        {
          error: "missing_required_files",
          missing,
        },
        { status: 404 },
      );
    }

    const files: Record<string, string> = {};
    for (const entry of entries) {
      if (typeof entry.content === "string") {
        files[entry.path] = entry.content;
      }
    }

    const payload = {
      generated_at: new Date().toISOString(),
      repo: {
        owner,
        name: repo,
        branch: branch ?? "HEAD",
        project: projectKey || undefined,
      },
      files,
    };

    return NextResponse.json(payload);
  } catch (error: any) {
    return NextResponse.json(
      {
        error: error?.message ?? "Failed to build context pack",
      },
      { status: 500 },
    );
  }
}
