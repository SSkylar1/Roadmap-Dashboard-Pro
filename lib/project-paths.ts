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

function inferProjectKeyFromPath(path: string): string | null | undefined {
  if (typeof path !== "string") return undefined;
  const normalized = path.trim().replace(/^\/+/, "");
  if (!normalized) return undefined;

  if (normalized.toLowerCase().startsWith("docs/projects/")) {
    const remainder = normalized.slice("docs/projects/".length);
    const [projectSegment] = remainder.split("/");
    if (!projectSegment) return undefined;
    const key = normalizeProjectKey(projectSegment);
    return key ?? undefined;
  }

  const rootPatterns = [
    /^docs\/roadmap(?:[./]|$)/i,
    /^docs\/roadmap-status\.json$/i,
    /^docs\/project-plan\.md$/i,
    /^docs\/roadmap\//i,
    /^docs\/roadmap\./i,
  ];
  if (rootPatterns.some((pattern) => pattern.test(normalized))) {
    return null;
  }

  const workflowMatch = normalized.match(/^\.github\/workflows\/roadmap(?:-(?<project>[^./]+))?\.ya?ml$/i);
  if (workflowMatch) {
    const projectValue = workflowMatch.groups?.project;
    if (!projectValue) return null;
    const key = normalizeProjectKey(projectValue);
    return key ?? null;
  }

  return undefined;
}

export function inferProjectsFromPaths(paths: string[]): Array<string | null> {
  const results = new Set<string | null>();
  for (const entry of paths) {
    const project = inferProjectKeyFromPath(entry);
    if (project === undefined) continue;
    results.add(project);
  }
  const ordered = Array.from(results);
  ordered.sort((a, b) => {
    if (a === b) return 0;
    if (a === null) return -1;
    if (b === null) return 1;
    return a.localeCompare(b);
  });
  return ordered;
}
