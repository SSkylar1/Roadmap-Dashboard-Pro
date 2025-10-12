import { normalizeProjectKey } from "./project-paths";
import type { RepoProjectSecrets } from "./secrets";

export type MergedProjectOption = {
  id: string;
  name: string;
  slug?: string;
  source: "stored" | "repo";
};

export function mergeProjectOptions(
  stored: RepoProjectSecrets[] | undefined,
  discoveredSlugs: string[],
): MergedProjectOption[] {
  const options: MergedProjectOption[] = [];
  const seen = new Set<string>();

  for (const project of stored ?? []) {
    const slugFromName = normalizeProjectKey(project.name);
    const slugFromId = normalizeProjectKey(project.id);
    const slug = slugFromName ?? slugFromId;
    if (slug) {
      seen.add(slug);
    }
    options.push({
      id: project.id,
      name: project.name,
      slug,
      source: "stored",
    });
  }

  for (const rawSlug of discoveredSlugs) {
    const trimmed = typeof rawSlug === "string" ? rawSlug.trim() : "";
    if (!trimmed) {
      continue;
    }
    const slug = normalizeProjectKey(trimmed);
    if (!slug || seen.has(slug)) {
      if (slug) {
        seen.add(slug);
      }
      continue;
    }
    seen.add(slug);
    options.push({
      id: trimmed,
      name: trimmed,
      slug,
      source: "repo",
    });
  }

  return options;
}
