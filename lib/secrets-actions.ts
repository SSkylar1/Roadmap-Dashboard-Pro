"use client";

import { normalizeSecretsForSave, type RepoSecrets, type SecretsStore } from "./secrets";
import { updateSecretsCache } from "./use-local-secrets";

async function persistStore(store: SecretsStore): Promise<SecretsStore> {
  const normalized = normalizeSecretsForSave(store);
  const response = await fetch("/api/settings/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(normalized),
  });

  const payload = (await response
    .json()
    .catch(() => ({}))) as { secrets?: SecretsStore; error?: string };

  if (!response.ok) {
    throw new Error(payload?.error || "Failed to save settings");
  }

  const saved = normalizeSecretsForSave(payload?.secrets ?? normalized);
  updateSecretsCache(saved);
  return saved;
}

function cloneStore(store: SecretsStore): SecretsStore {
  return {
    defaults: { ...store.defaults },
    repos: store.repos.map((repo) => ({
      ...repo,
      projects: repo.projects.map((project) => ({ ...project })),
    })),
  };
}

export async function removeRepoFromStore(currentStore: SecretsStore, repoId: string): Promise<SecretsStore> {
  const cloned = cloneStore(currentStore);
  const nextRepos = cloned.repos.filter((repo) => repo.id !== repoId);
  if (nextRepos.length === cloned.repos.length) {
    return cloned;
  }
  return persistStore({ ...cloned, repos: nextRepos });
}

export async function removeProjectFromStore(
  currentStore: SecretsStore,
  repoId: string,
  projectId: string,
): Promise<SecretsStore> {
  const cloned = cloneStore(currentStore);
  const repo = cloned.repos.find((entry) => entry.id === repoId);
  if (!repo) {
    return cloned;
  }
  const nextProjects = repo.projects.filter((project) => project.id !== projectId);
  if (nextProjects.length === repo.projects.length) {
    return cloned;
  }
  const nextRepos = cloned.repos.map((entry) =>
    entry.id === repoId
      ? ({
          ...entry,
          projects: nextProjects,
        } as RepoSecrets)
      : entry,
  );
  return persistStore({ ...cloned, repos: nextRepos });
}

export async function persistSecretsStore(store: SecretsStore): Promise<SecretsStore> {
  const cloned = cloneStore(store);
  return persistStore(cloned);
}
