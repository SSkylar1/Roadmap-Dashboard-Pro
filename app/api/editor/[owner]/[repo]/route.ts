import { NextRequest, NextResponse } from "next/server";

import { getFileRaw, putFile } from "@/lib/github";
import { describeProjectFile, normalizeProjectKey, projectAwarePath } from "@/lib/project-paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizeBranch(value: string | null): string {
  if (!value) return "main";
  const trimmed = value.trim();
  return trimmed ? trimmed : "main";
}

function normalizePath(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim().replace(/^\/+/, "");
  return trimmed.length > 0 ? trimmed : null;
}

type RouteParams = { params: { owner: string; repo: string } };

type LoadResponse = {
  path: string;
  exists: boolean;
  content: string;
};

type SavePayload = {
  path?: string;
  content?: string;
  branch?: string;
  message?: string;
  project?: string | null;
};

type SaveResponse = {
  ok: true;
  path: string;
  branch: string;
  message: string;
};

export async function GET(req: NextRequest, { params }: RouteParams) {
  const { owner, repo } = params;
  const url = new URL(req.url);
  const branch = normalizeBranch(url.searchParams.get("branch"));
  const projectKey = normalizeProjectKey(url.searchParams.get("project"));
  const rawPath = normalizePath(url.searchParams.get("path"));

  if (!rawPath) {
    return NextResponse.json({ error: "path is required" }, { status: 400 });
  }

  const targetPath = projectKey ? projectAwarePath(rawPath, projectKey) : rawPath;

  try {
    const token = req.headers.get("x-github-pat")?.trim() || undefined;
    const content = await getFileRaw(owner, repo, targetPath, branch, token);
    if (content === null) {
      return NextResponse.json(
        {
          path: describeProjectFile(rawPath, projectKey),
          exists: false,
          content: "",
        } satisfies LoadResponse,
        { status: 200 },
      );
    }

    return NextResponse.json(
      {
        path: describeProjectFile(rawPath, projectKey),
        exists: true,
        content,
      } satisfies LoadResponse,
      { status: 200 },
    );
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message ?? "Failed to load file" },
      { status: 500 },
    );
  }
}

export async function PUT(req: NextRequest, { params }: RouteParams) {
  const { owner, repo } = params;
  let body: SavePayload = {};
  try {
    body = (await req.json()) as SavePayload;
  } catch {
    // ignore malformed body; validation below will handle missing fields
  }

  const rawPath = normalizePath(typeof body.path === "string" ? body.path : null);
  if (!rawPath) {
    return NextResponse.json({ error: "path is required" }, { status: 400 });
  }

  const content = typeof body.content === "string" ? body.content : null;
  if (content === null) {
    return NextResponse.json({ error: "content is required" }, { status: 400 });
  }

  const branch = normalizeBranch(typeof body.branch === "string" ? body.branch : null);
  const projectKey = normalizeProjectKey(body.project ?? null);
  const message = typeof body.message === "string" && body.message.trim().length > 0
    ? body.message.trim()
    : projectKey
      ? `chore(${projectKey}): update ${describeProjectFile(rawPath, projectKey)} via smart editor`
      : `chore: update ${rawPath} via smart editor`;

  const targetPath = projectKey ? projectAwarePath(rawPath, projectKey) : rawPath;

  try {
    const token = req.headers.get("x-github-pat")?.trim() || undefined;
    await putFile(owner, repo, targetPath, content, branch, message, token);
    return NextResponse.json(
      {
        ok: true,
        path: describeProjectFile(rawPath, projectKey),
        branch,
        message,
      } satisfies SaveResponse,
      { status: 200 },
    );
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message ?? "Failed to save file" },
      { status: 500 },
    );
  }
}
