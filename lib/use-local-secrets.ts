"use client";

import { useEffect, useMemo, useState } from "react";

export type RepoProjectSecrets = {
  id: string;
  name: string;
  supabaseReadOnlyUrl?: string;
  githubPat?: string;
  openaiKey?: string;
};

export type RepoSecrets = {
  id: string;
  owner: string;
  repo: string;
  displayName?: string;
  supabaseReadOnlyUrl?: string;
  githubPat?: string;
  openaiKey?: string;
  projects: RepoProjectSecrets[];
};

export type SecretsStore = {
  defaults: {
    githubPat?: string;
    openaiKey?: string;
    supabaseReadOnlyUrl?: string;
  };
  repos: RepoSecrets[];
};

export type ResolvedSecrets = {
  githubPat?: string;
  openaiKey?: string;
  supabaseReadOnlyUrl?: string;
  sources: {
    githubPat?: "project" | "repo" | "default";
    openaiKey?: "project" | "repo" | "default";
    supabaseReadOnlyUrl?: "project" | "repo" | "default";
  };
  repo?: RepoSecrets;
  project?: RepoProjectSecrets;
};

export const LOCAL_SECRETS_STORAGE_KEY = "rdp.settings.secrets";
export const LOCAL_SECRETS_EVENT = "rdp:secrets-updated";

const EMPTY_STORE: SecretsStore = {
  defaults: {},
  repos: [],
};

function sanitizeString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "project";
}

function randomId(prefix: string) {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeProject(project: any, index: number): RepoProjectSecrets | null {
  const name = sanitizeString(project?.name) ?? sanitizeString(project?.label) ?? sanitizeString(project?.id);
  if (!name) {
    return null;
  }
  const id = sanitizeString(project?.id) ?? `${slugify(name)}-${index}`;
  return {
    id,
    name,
    ...(sanitizeString(project?.supabaseReadOnlyUrl)
      ? { supabaseReadOnlyUrl: sanitizeString(project?.supabaseReadOnlyUrl) }
      : {}),
    ...(sanitizeString(project?.githubPat) ? { githubPat: sanitizeString(project?.githubPat) } : {}),
    ...(sanitizeString(project?.openaiKey) ? { openaiKey: sanitizeString(project?.openaiKey) } : {}),
  };
}

function normalizeRepo(repo: any, index: number): RepoSecrets | null {
  const owner = sanitizeString(repo?.owner);
  const name = sanitizeString(repo?.repo);
  if (!owner || !name) {
    return null;
  }
  const id = sanitizeString(repo?.id) ?? `${owner.toLowerCase()}/${name.toLowerCase()}`;
  const projects = Array.isArray(repo?.projects)
    ? (repo.projects
        .map((project: any, projectIndex: number) => normalizeProject(project, projectIndex))
        .filter(Boolean) as RepoProjectSecrets[])
    : [];

  return {
    id,
    owner,
    repo: name,
    projects,
    ...(sanitizeString(repo?.displayName) ? { displayName: sanitizeString(repo?.displayName) } : {}),
    ...(sanitizeString(repo?.supabaseReadOnlyUrl)
      ? { supabaseReadOnlyUrl: sanitizeString(repo?.supabaseReadOnlyUrl) }
      : {}),
    ...(sanitizeString(repo?.githubPat) ? { githubPat: sanitizeString(repo?.githubPat) } : {}),
    ...(sanitizeString(repo?.openaiKey) ? { openaiKey: sanitizeString(repo?.openaiKey) } : {}),
  };
}

function parseSecrets(raw: string | null): SecretsStore {
  if (!raw) return EMPTY_STORE;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return EMPTY_STORE;
    }

    if ("defaults" in parsed || "repos" in parsed) {
      const defaultsInput = (parsed as Partial<SecretsStore>)?.defaults ?? {};
      const reposInput = Array.isArray((parsed as Partial<SecretsStore>)?.repos)
        ? ((parsed as Partial<SecretsStore>).repos as any[])
        : [];

      const defaults = {
        ...(sanitizeString((defaultsInput as any)?.githubPat)
          ? { githubPat: sanitizeString((defaultsInput as any)?.githubPat) }
          : {}),
        ...(sanitizeString((defaultsInput as any)?.openaiKey)
          ? { openaiKey: sanitizeString((defaultsInput as any)?.openaiKey) }
          : {}),
        ...(sanitizeString((defaultsInput as any)?.supabaseReadOnlyUrl)
          ? { supabaseReadOnlyUrl: sanitizeString((defaultsInput as any)?.supabaseReadOnlyUrl) }
          : {}),
      };

      const repos = reposInput
        .map((repo, repoIndex) => normalizeRepo(repo, repoIndex))
        .filter(Boolean) as RepoSecrets[];

      return { defaults, repos };
    }

    const defaults: SecretsStore["defaults"] = {};
    const githubPat = sanitizeString((parsed as any)?.githubPat);
    const openaiKey = sanitizeString((parsed as any)?.openaiKey);
    const supabase = sanitizeString((parsed as any)?.supabaseReadOnlyUrl);

    if (githubPat) defaults.githubPat = githubPat;
    if (openaiKey) defaults.openaiKey = openaiKey;
    if (supabase) defaults.supabaseReadOnlyUrl = supabase;

    return { defaults, repos: [] };
  } catch (error) {
    console.warn("Failed to parse stored secrets", error);
    return EMPTY_STORE;
  }
}

export function readLocalSecrets(): SecretsStore {
  if (typeof window === "undefined") {
    return EMPTY_STORE;
  }
  const raw = window.localStorage.getItem(LOCAL_SECRETS_STORAGE_KEY);
  return parseSecrets(raw);
}

export function useLocalSecrets() {
  const [store, setStore] = useState<SecretsStore>(() => {
    if (typeof window === "undefined") {
      return EMPTY_STORE;
    }
    return readLocalSecrets();
  });

  useEffect(() => {
    function refresh() {
      setStore(readLocalSecrets());
    }

    window.addEventListener("storage", refresh);
    window.addEventListener(LOCAL_SECRETS_EVENT, refresh);

    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener(LOCAL_SECRETS_EVENT, refresh);
    };
  }, []);

  return store;
}

function matchRepo(store: SecretsStore, owner?: string, repo?: string): RepoSecrets | undefined {
  if (!owner || !repo) return undefined;
  const normalizedOwner = owner.trim().toLowerCase();
  const normalizedRepo = repo.trim().toLowerCase();
  return store.repos.find((entry) =>
    entry.owner.trim().toLowerCase() === normalizedOwner && entry.repo.trim().toLowerCase() === normalizedRepo,
  );
}

export function resolveSecrets(
  store: SecretsStore,
  owner?: string,
  repo?: string,
  projectId?: string | null,
): ResolvedSecrets {
  const defaults = store?.defaults ?? {};
  let githubPat = sanitizeString(defaults.githubPat);
  let openaiKey = sanitizeString(defaults.openaiKey);
  let supabaseReadOnlyUrl = sanitizeString(defaults.supabaseReadOnlyUrl);
  const sources: ResolvedSecrets["sources"] = {
    ...(githubPat ? { githubPat: "default" as const } : {}),
    ...(openaiKey ? { openaiKey: "default" as const } : {}),
    ...(supabaseReadOnlyUrl ? { supabaseReadOnlyUrl: "default" as const } : {}),
  };

  const repoEntry = owner && repo ? matchRepo(store, owner, repo) : undefined;
  let projectEntry: RepoProjectSecrets | undefined;

  if (repoEntry) {
    if (sanitizeString(repoEntry.githubPat)) {
      githubPat = sanitizeString(repoEntry.githubPat);
      sources.githubPat = "repo";
    }
    if (sanitizeString(repoEntry.openaiKey)) {
      openaiKey = sanitizeString(repoEntry.openaiKey);
      sources.openaiKey = "repo";
    }
    if (sanitizeString(repoEntry.supabaseReadOnlyUrl)) {
      supabaseReadOnlyUrl = sanitizeString(repoEntry.supabaseReadOnlyUrl);
      sources.supabaseReadOnlyUrl = "repo";
    }
    if (projectId) {
      projectEntry = repoEntry.projects.find((project) => project.id === projectId);
    }
    if (!projectEntry && repoEntry.projects.length === 1 && !projectId) {
      projectEntry = repoEntry.projects[0];
    }
    if (projectEntry) {
      if (sanitizeString(projectEntry.githubPat)) {
        githubPat = sanitizeString(projectEntry.githubPat);
        sources.githubPat = "project";
      }
      if (sanitizeString(projectEntry.openaiKey)) {
        openaiKey = sanitizeString(projectEntry.openaiKey);
        sources.openaiKey = "project";
      }
      if (sanitizeString(projectEntry.supabaseReadOnlyUrl)) {
        supabaseReadOnlyUrl = sanitizeString(projectEntry.supabaseReadOnlyUrl);
        sources.supabaseReadOnlyUrl = "project";
      }
    }
  }

  return {
    githubPat,
    openaiKey,
    supabaseReadOnlyUrl,
    sources,
    repo: repoEntry,
    project: projectEntry,
  };
}

export function useResolvedSecrets(owner?: string, repo?: string, projectId?: string | null) {
  const store = useLocalSecrets();
  return useMemo(() => resolveSecrets(store, owner, repo, projectId ?? undefined), [store, owner, repo, projectId]);
}

export function createRepoEntry(owner: string, repo: string, displayName?: string): RepoSecrets {
  const trimmedOwner = owner.trim();
  const trimmedRepo = repo.trim();
  const id = `${trimmedOwner.toLowerCase()}/${trimmedRepo.toLowerCase()}`;
  return {
    id,
    owner: trimmedOwner,
    repo: trimmedRepo,
    displayName: displayName?.trim() || undefined,
    projects: [],
  };
}

export function createProjectEntry(name: string): RepoProjectSecrets {
  const trimmed = name.trim();
  return {
    id: `${slugify(trimmed)}-${randomId("project")}`,
    name: trimmed,
  };
}

export function writeSecretsToStorage(store: SecretsStore) {
  if (typeof window === "undefined") return;
  const payload = JSON.stringify(store);
  window.localStorage.setItem(LOCAL_SECRETS_STORAGE_KEY, payload);
  window.dispatchEvent(new Event(LOCAL_SECRETS_EVENT));
}

export function normalizeSecretsForSave(store: SecretsStore): SecretsStore {
  const defaults = {
    ...(sanitizeString(store?.defaults?.githubPat)
      ? { githubPat: sanitizeString(store.defaults.githubPat)! }
      : {}),
    ...(sanitizeString(store?.defaults?.openaiKey)
      ? { openaiKey: sanitizeString(store.defaults.openaiKey)! }
      : {}),
    ...(sanitizeString(store?.defaults?.supabaseReadOnlyUrl)
      ? { supabaseReadOnlyUrl: sanitizeString(store.defaults.supabaseReadOnlyUrl)! }
      : {}),
  };

  const repos = (store?.repos ?? [])
    .map((repo) => {
      const owner = sanitizeString(repo?.owner);
      const name = sanitizeString(repo?.repo);
      if (!owner || !name) {
        return null;
      }

      const normalized: RepoSecrets = {
        id: `${owner.toLowerCase()}/${name.toLowerCase()}`,
        owner,
        repo: name,
        projects: [],
        ...(sanitizeString(repo?.displayName) ? { displayName: sanitizeString(repo?.displayName) } : {}),
        ...(sanitizeString(repo?.supabaseReadOnlyUrl)
          ? { supabaseReadOnlyUrl: sanitizeString(repo?.supabaseReadOnlyUrl) }
          : {}),
        ...(sanitizeString(repo?.githubPat) ? { githubPat: sanitizeString(repo?.githubPat) } : {}),
        ...(sanitizeString(repo?.openaiKey) ? { openaiKey: sanitizeString(repo?.openaiKey) } : {}),
      };

      normalized.projects = (repo?.projects ?? [])
        .map((project) => {
          const name = sanitizeString(project?.name);
          if (!name) {
            return null;
          }
          const id = sanitizeString(project?.id) ?? `${slugify(name)}-${randomId("project")}`;
          return {
            id,
            name,
            ...(sanitizeString(project?.supabaseReadOnlyUrl)
              ? { supabaseReadOnlyUrl: sanitizeString(project?.supabaseReadOnlyUrl) }
              : {}),
            ...(sanitizeString(project?.githubPat) ? { githubPat: sanitizeString(project?.githubPat) } : {}),
            ...(sanitizeString(project?.openaiKey) ? { openaiKey: sanitizeString(project?.openaiKey) } : {}),
          } as RepoProjectSecrets;
        })
        .filter(Boolean) as RepoProjectSecrets[];

      return normalized;
    })
    .filter(Boolean) as RepoSecrets[];

  return { defaults, repos };
}
