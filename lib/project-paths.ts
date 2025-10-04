export function normalizeProjectKey(input?: string | null): string | undefined {
  if (typeof input !== "string") return undefined;
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return undefined;
  const normalized = trimmed
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return normalized || undefined;
}

export function projectAwarePath(path: string, projectKey?: string | null): string {
  const key = normalizeProjectKey(projectKey);
  if (!key) return path;
  if (path.startsWith("docs/")) {
    const remainder = path.slice("docs/".length);
    return `docs/projects/${key}/${remainder}`;
  }
  if (path === ".github/workflows/roadmap.yml") {
    return `.github/workflows/roadmap-${key}.yml`;
  }
  return path;
}

export function describeProjectFile(path: string, projectKey?: string | null): string {
  const key = normalizeProjectKey(projectKey);
  if (!key) return path;
  if (path.startsWith("docs/")) {
    const remainder = path.slice("docs/".length);
    return `docs/projects/${key}/${remainder}`;
  }
  if (path === ".github/workflows/roadmap.yml") {
    return `.github/workflows/roadmap-${key}.yml`;
  }
  return path;
}
