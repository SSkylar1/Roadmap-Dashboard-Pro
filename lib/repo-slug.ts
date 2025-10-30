import { normalizeProjectKey } from "./project-paths";
import type { RepoRef } from "../types/repos";

export function formatRepoSlug(repo: RepoRef): string {
  const owner = typeof repo.owner === "string" ? repo.owner.trim() : "";
  const repoName = typeof repo.repo === "string" ? repo.repo.trim() : "";
  if (!owner || !repoName) {
    return "";
  }
  const base = `${owner}/${repoName}`;
  const projectKey = normalizeProjectKey(repo.project ?? undefined);
  return projectKey ? `${base}#${projectKey}` : base;
}

export function matchesRepoSlugConfirmation(input: string, repo: RepoRef): boolean {
  const expected = formatRepoSlug(repo);
  if (!expected) {
    return false;
  }
  const normalizedInput = input.trim();
  if (!normalizedInput) {
    return false;
  }
  return normalizedInput.toLowerCase() === expected.toLowerCase();
}
