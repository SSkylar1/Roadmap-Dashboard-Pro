import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";

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
    if (!pathParam) {
      return NextResponse.json({ error: "Missing path" }, { status: 400 });
    }

    const normalized = path.posix.normalize(pathParam.replace(/\\/g, "/"));
    if (!normalized || normalized === "docs" || !normalized.startsWith("docs/")) {
      return NextResponse.json({ error: "Only docs/* paths can be shared" }, { status: 400 });
    }

    const filePath = path.join(process.cwd(), normalized);
    const docsDir = path.join(process.cwd(), "docs");
    if (!filePath.startsWith(docsDir)) {
      return NextResponse.json({ error: "Invalid path" }, { status: 400 });
    }

    const stats = await fs.stat(filePath).catch(() => null);
    if (!stats || !stats.isFile()) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    const content = await fs.readFile(filePath, "utf8");
    return NextResponse.json({
      ok: true,
      path: normalized,
      name: path.basename(filePath),
      size: stats.size,
      sizeLabel: formatBytes(stats.size),
      content,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message ?? "Failed to load shared file" }, { status: 500 });
  }
}
