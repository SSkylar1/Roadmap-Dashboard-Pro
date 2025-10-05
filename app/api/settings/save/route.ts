import { NextRequest, NextResponse } from "next/server";

import { persistSecrets } from "@/lib/server-secrets";
import { normalizeSecretsForSave, type SecretsStore } from "@/lib/secrets";

function isOptionalString(value: unknown) {
  return typeof value === "undefined" || typeof value === "string";
}

function hasText(value: unknown) {
  return typeof value === "string" && value.trim().length > 0;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "invalid payload" }, { status: 400 });
    }

    const { defaults, repos } = body as {
      defaults?: Record<string, unknown>;
      repos?: Array<Record<string, unknown>>;
    };

    if (defaults && typeof defaults !== "object") {
      return NextResponse.json({ error: "invalid defaults" }, { status: 400 });
    }

    if (defaults) {
      for (const key of Object.keys(defaults)) {
        if (!isOptionalString((defaults as Record<string, unknown>)[key])) {
          return NextResponse.json({ error: "defaults must be strings" }, { status: 400 });
        }
      }
    }

    if (repos && !Array.isArray(repos)) {
      return NextResponse.json({ error: "invalid repos" }, { status: 400 });
    }

    if (Array.isArray(repos)) {
      for (const repo of repos) {
        if (!hasText(repo?.owner) || !hasText(repo?.repo)) {
          return NextResponse.json({ error: "repo must include owner and repo" }, { status: 400 });
        }
        if (!isOptionalString(repo?.displayName)) {
          return NextResponse.json({ error: "invalid displayName" }, { status: 400 });
        }
        if (!isOptionalString(repo?.supabaseReadOnlyUrl)) {
          return NextResponse.json({ error: "invalid supabase url" }, { status: 400 });
        }
        if (!isOptionalString(repo?.githubPat) || !isOptionalString(repo?.openaiKey)) {
          return NextResponse.json({ error: "invalid repo secrets" }, { status: 400 });
        }

        if (repo?.projects && !Array.isArray(repo.projects)) {
          return NextResponse.json({ error: "invalid projects" }, { status: 400 });
        }

        if (Array.isArray(repo?.projects)) {
          for (const project of repo.projects as Array<Record<string, unknown>>) {
            if (!hasText(project?.name ?? project?.id)) {
              return NextResponse.json({ error: "project name required" }, { status: 400 });
            }
            if (!isOptionalString(project?.id)) {
              return NextResponse.json({ error: "invalid project id" }, { status: 400 });
            }
            if (
              !isOptionalString(project?.supabaseReadOnlyUrl) ||
              !isOptionalString(project?.githubPat) ||
              !isOptionalString(project?.openaiKey)
            ) {
              return NextResponse.json({ error: "invalid project secrets" }, { status: 400 });
            }
          }
        }
      }
    }

    const incoming: SecretsStore = {
      defaults: (defaults as SecretsStore["defaults"]) ?? {},
      repos: (repos as SecretsStore["repos"]) ?? [],
    };

    const normalized = normalizeSecretsForSave(incoming);
    const persisted = await persistSecrets(normalized);

    return NextResponse.json({ secrets: persisted });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: "unable to parse request" }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : "unexpected error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
