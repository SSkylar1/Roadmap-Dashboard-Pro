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

export const EMPTY_STORE: SecretsStore = {
  defaults: {},
  repos: [],
};

export function sanitizeString(value: unknown): string | undefined {
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
  const runtimeCrypto: Crypto | undefined = typeof crypto !== "undefined" ? crypto : undefined;
  if (runtimeCrypto && typeof runtimeCrypto.randomUUID === "function") {
    return `${prefix}-${runtimeCrypto.randomUUID()}`;
  }
  const random = Math.random().toString(36).slice(2, 12);
  return `${prefix}-${random}`;
}

function matchRepo(store: SecretsStore, owner?: string, repo?: string): RepoSecrets | undefined {
  if (!owner || !repo) return undefined;
  const normalizedOwner = owner.trim().toLowerCase();
  const normalizedRepo = repo.trim().toLowerCase();
  return store.repos.find(
    (entry) => entry.owner.trim().toLowerCase() === normalizedOwner && entry.repo.trim().toLowerCase() === normalizedRepo,
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
    .map((repo, _repoIndex) => {
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
        .map((project, projectIndex) => {
          const name = sanitizeString(project?.name);
          if (!name) {
            return null;
          }
          const id = sanitizeString(project?.id) ?? `${slugify(name)}-${projectIndex}`;
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
