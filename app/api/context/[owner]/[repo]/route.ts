import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { NextRequest, NextResponse } from "next/server";

import { STANDALONE_MODE } from "@/lib/config";
import { getFileRaw } from "@/lib/github";
import { loadManualState } from "@/lib/manual-store";
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

type DashboardFile = {
  path: string;
  optional?: boolean;
  projectAware?: boolean;
};

const CONTEXT_FILES: ContextPackFile[] = [
  { path: "docs/roadmap.yml" },
  { path: "docs/roadmap-status.json" },
  { path: "docs/tech-stack.yml" },
  { path: "docs/backlog-discovered.yml" },
  { path: "docs/summary.txt" },
  { path: "docs/gtm-plan.md", optional: true },
];

const DASHBOARD_FILES: DashboardFile[] = [
  { path: "README.md", projectAware: false },
  { path: "docs/supabase-setup.md", projectAware: false },
  { path: "docs/supabase-read-only-checks.md", projectAware: false, optional: true },
];

function describeDashboardPath(path: string, _projectKey?: string | null): string {
  const normalized = path.replace(/^\/+/, "");
  return `dashboard/${normalized}`;
}

function normalizeBranch(value: string | null): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function parseOptionalBoolean(value: string | null): boolean | null {
  if (value === null || value === undefined) return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return null;
}

async function readLocalFileCandidates(paths: string[]): Promise<string | null> {
  for (const candidate of paths) {
    const resolved = resolve(process.cwd(), candidate);
    try {
      const raw = await readFile(resolved, "utf-8");
      return raw;
    } catch (error) {
      continue;
    }
  }
  return null;
}

function buildLocalDashboardCandidates(path: string, projectKey?: string | null): string[] {
  if (!path.startsWith("docs/")) {
    return [path];
  }
  const candidates = [path];
  const key = normalizeProjectKey(projectKey);
  if (key) {
    const remainder = path.slice("docs/".length);
    candidates.unshift(`docs/projects/${key}/${remainder}`);
  }
  return candidates;
}

function formatStandaloneStatusSnapshot(snapshot: ReturnType<typeof getLatestStandaloneStatusSnapshot> | null) {
  if (!snapshot) {
    return {
      message: "Standalone mode has not generated a roadmap status snapshot yet.",
    };
  }
  return {
    source: "standalone",
    snapshot: snapshot.payload,
    meta: {
      id: snapshot.id,
      workspace_id: snapshot.workspace_id,
      project_id: snapshot.project_id,
      branch: snapshot.branch,
      created_at: snapshot.created_at,
    },
  };
}

export async function GET(req: NextRequest, { params }: RouteParams) {
  const { owner, repo } = params;
  const url = new URL(req.url);
  const branch = normalizeBranch(url.searchParams.get("branch"));
  const projectKey = normalizeProjectKey(url.searchParams.get("project"));
  const includeDashboard = parseOptionalBoolean(url.searchParams.get("includeDashboard")) ?? true;

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

      if (includeDashboard) {
        const dashboardFiles: Record<string, string> = {};

        for (const entry of DASHBOARD_FILES) {
          const candidates = buildLocalDashboardCandidates(entry.path, projectKey ?? null);
          const content = await readLocalFileCandidates(candidates);
          const dashboardPath = describeDashboardPath(entry.path, projectKey);
          if (typeof content === "string") {
            dashboardFiles[dashboardPath] = content;
          } else if (!entry.optional) {
            dashboardFiles[dashboardPath] = [
              `# Missing ${entry.path}`,
              "This file was not found in the local workspace during export.",
              "",
            ].join("\n");
          }
        }

        const statusRecord = formatStandaloneStatusSnapshot(snapshot);
        dashboardFiles[describeDashboardPath("status/latest.json", projectKey)] = JSON.stringify(
          {
            ...statusRecord,
            project: projectKey ?? null,
            branch: branch ?? null,
            exported_at: new Date().toISOString(),
          },
          null,
          2,
        );

        let manualPayload: string;
        try {
          const manualResult = await loadManualState(owner, repo, projectKey ?? null);
          if (manualResult.available) {
            manualPayload = JSON.stringify(
              {
                available: true,
                project: projectKey ?? null,
                branch: branch ?? null,
                updated_at: manualResult.updated_at,
                state: manualResult.state,
              },
              null,
              2,
            );
          } else {
            manualPayload = JSON.stringify(
              {
                available: false,
                project: projectKey ?? null,
                branch: branch ?? null,
                message: "Manual roadmap overrides store is not configured in standalone mode.",
              },
              null,
              2,
            );
          }
        } catch (manualError: any) {
          manualPayload = JSON.stringify(
            {
              available: false,
              project: projectKey ?? null,
              branch: branch ?? null,
              error: manualError?.message ?? "Failed to load manual roadmap overrides.",
            },
            null,
            2,
          );
        }
        dashboardFiles[describeDashboardPath("manual/latest.json", projectKey)] = manualPayload;

        for (const [path, content] of Object.entries(dashboardFiles)) {
          files[path] = content;
        }
      }

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

    if (includeDashboard) {
      const dashboardFiles: Record<string, string> = {};

      for (const entry of DASHBOARD_FILES) {
        const remotePath = entry.projectAware === false ? entry.path : projectAwarePath(entry.path, projectKey);
        const dashboardPath = describeDashboardPath(entry.path, projectKey);
        const content = await getFileRaw(owner, repo, remotePath, branch, token).catch(() => null);
        if (typeof content === "string") {
          dashboardFiles[dashboardPath] = content;
        } else if (!entry.optional) {
          dashboardFiles[dashboardPath] = [
            `# Missing ${entry.path}`,
            `This file was not found on ${branch ?? "HEAD"} when building the dashboard export.`,
            "",
          ].join("\n");
        }
      }

      const statusPath = describeProjectFile("docs/roadmap-status.json", projectKey);
      const statusContent = files[statusPath];
      if (typeof statusContent === "string") {
        dashboardFiles[describeDashboardPath("status/latest.json", projectKey)] = statusContent;
      }

      let manualPayload: string;
      try {
        const manualResult = await loadManualState(owner, repo, projectKey ?? null);
        if (manualResult.available) {
          manualPayload = JSON.stringify(
            {
              available: true,
              project: projectKey ?? null,
              branch: branch ?? null,
              updated_at: manualResult.updated_at,
              state: manualResult.state,
            },
            null,
            2,
          );
        } else {
          manualPayload = JSON.stringify(
            {
              available: false,
              project: projectKey ?? null,
              branch: branch ?? null,
              message: "Manual roadmap overrides store is not configured.",
            },
            null,
            2,
          );
        }
      } catch (manualError: any) {
        manualPayload = JSON.stringify(
          {
            available: false,
            project: projectKey ?? null,
            branch: branch ?? null,
            error: manualError?.message ?? "Failed to load manual roadmap overrides.",
          },
          null,
          2,
        );
      }
      dashboardFiles[describeDashboardPath("manual/latest.json", projectKey)] = manualPayload;

      for (const [path, content] of Object.entries(dashboardFiles)) {
        files[path] = content;
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
