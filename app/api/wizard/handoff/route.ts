import { NextResponse } from "next/server";
import path from "path";

import { getFileRaw } from "@/lib/github";
import { describeProjectFile, normalizeProjectKey, projectAwarePath } from "@/lib/project-paths";

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const precision = value < 10 && unitIndex > 0 ? 1 : 0;
  return `${value.toFixed(precision)} ${units[unitIndex]}`;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const pathParam = url.searchParams.get("path");
    const owner = url.searchParams.get("owner");
    const repo = url.searchParams.get("repo");
    const branch = url.searchParams.get("branch") ?? "main";
    const projectParam = url.searchParams.get("project");

    if (!pathParam || !owner || !repo) {
      return NextResponse.json({ error: "Missing path or repository context" }, { status: 400 });
    }

    const normalized = path.posix.normalize(pathParam.replace(/\\/g, "/"));
    if (!normalized || normalized === "docs" || !normalized.startsWith("docs/")) {
      return NextResponse.json({ error: "Only docs/* paths can be shared" }, { status: 400 });
    }

    if (normalized.includes("..")) {
      return NextResponse.json({ error: "Invalid path" }, { status: 400 });
    }

    const projectKey = normalizeProjectKey(projectParam);
    const label = describeProjectFile(normalized, projectKey);
    const targetPath = normalized.startsWith("docs/projects/")
      ? normalized
      : projectAwarePath(normalized, projectKey);

    const token = request.headers.get("x-github-pat") ?? undefined;
    const content = await getFileRaw(owner, repo, targetPath, branch, token);
    if (content === null) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    const size = new TextEncoder().encode(content).length;

    return NextResponse.json({
      ok: true,
      path: normalized,
      label,
      name: path.basename(targetPath),
      size,
      sizeLabel: formatBytes(size),
      content,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message ?? "Failed to load shared file" }, { status: 500 });
  }
}
