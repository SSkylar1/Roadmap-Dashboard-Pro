"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";

import {
  createProjectEntry,
  createRepoEntry,
  normalizeSecretsForSave,
  readLocalSecrets,
  type RepoProjectSecrets,
  type RepoSecrets,
  type SecretsStore,
  resolveSecrets,
  useLocalSecrets,
  writeSecretsToStorage,
} from "@/lib/use-local-secrets";

const EMPTY_STORE: SecretsStore = { defaults: {}, repos: [] };

type RepoFormState = {
  owner: string;
  repo: string;
  displayName: string;
};

type ProjectFormState = {
  name: string;
};

export default function SettingsPage() {
  const [store, setStore] = useState<SecretsStore>(EMPTY_STORE);
  const [initialSerialized, setInitialSerialized] = useState<string>("{}");
  const [selectedRepoId, setSelectedRepoId] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [repoError, setRepoError] = useState<string | null>(null);
  const [projectError, setProjectError] = useState<string | null>(null);
  const [repoForm, setRepoForm] = useState<RepoFormState>({ owner: "", repo: "", displayName: "" });
  const [projectForm, setProjectForm] = useState<ProjectFormState>({ name: "" });

  const liveStore = useLocalSecrets();

  useEffect(() => {
    try {
      const loaded = normalizeSecretsForSave(readLocalSecrets());
      setStore(loaded);
      const serialized = JSON.stringify(loaded);
      setInitialSerialized(serialized);
      if (loaded.repos.length) {
        setSelectedRepoId(loaded.repos[0].id);
        if (loaded.repos[0].projects.length) {
          setSelectedProjectId(loaded.repos[0].projects[0].id);
        }
      }
    } catch (err) {
      console.error("Failed to load stored secrets", err);
    }
  }, []);

  useEffect(() => {
    if (selectedRepoId && !store.repos.some((repo) => repo.id === selectedRepoId)) {
      const fallback = store.repos[0]?.id ?? null;
      setSelectedRepoId(fallback);
      const fallbackRepo = fallback ? store.repos.find((repo) => repo.id === fallback) ?? null : null;
      setSelectedProjectId(fallbackRepo?.projects[0]?.id ?? null);
    }
  }, [selectedRepoId, store.repos]);

  useEffect(() => {
    if (!selectedRepoId) {
      setSelectedProjectId(null);
      return;
    }
    const repo = store.repos.find((entry) => entry.id === selectedRepoId);
    if (!repo) {
      setSelectedProjectId(null);
      return;
    }
    if (selectedProjectId && !repo.projects.some((project) => project.id === selectedProjectId)) {
      setSelectedProjectId(repo.projects[0]?.id ?? null);
    }
  }, [selectedRepoId, selectedProjectId, store.repos]);

  const selectedRepo = useMemo(
    () => store.repos.find((repo) => repo.id === selectedRepoId) ?? null,
    [store.repos, selectedRepoId],
  );

  const selectedProject = useMemo(
    () => selectedRepo?.projects.find((project) => project.id === selectedProjectId) ?? null,
    [selectedRepo, selectedProjectId],
  );

  const normalizedForComparison = useMemo(() => JSON.stringify(normalizeSecretsForSave(store)), [store]);
  const hasChanges = normalizedForComparison !== initialSerialized;

  useEffect(() => {
    const normalizedLive = normalizeSecretsForSave(liveStore);
    const serializedLive = JSON.stringify(normalizedLive);
    if (!hasChanges && serializedLive !== initialSerialized) {
      setStore(normalizedLive);
      setInitialSerialized(serializedLive);
      if (!selectedRepoId && normalizedLive.repos.length) {
        setSelectedRepoId(normalizedLive.repos[0].id);
        setSelectedProjectId(normalizedLive.repos[0].projects[0]?.id ?? null);
      }
    }
  }, [hasChanges, initialSerialized, liveStore, selectedRepoId]);

  const defaultGithub = Boolean(store.defaults.githubPat && store.defaults.githubPat.trim());
  const defaultOpenAi = Boolean(store.defaults.openaiKey && store.defaults.openaiKey.trim());

  const repoResolved = selectedRepo
    ? resolveSecrets(store, selectedRepo.owner, selectedRepo.repo, selectedProject?.id)
    : null;
  const supabaseSourceLabel = repoResolved?.sources.supabaseReadOnlyUrl
    ? repoResolved.sources.supabaseReadOnlyUrl === "project"
      ? "project override"
      : repoResolved.sources.supabaseReadOnlyUrl === "repo"
      ? "repo default"
      : "global default"
    : null;

  const handleRepoFormChange = (field: keyof RepoFormState) => (event: ChangeEvent<HTMLInputElement>) => {
    setRepoForm((prev) => ({ ...prev, [field]: event.target.value }));
  };

  const handleProjectFormChange = (event: ChangeEvent<HTMLInputElement>) => {
    setProjectForm({ name: event.target.value });
  };

  const addRepository = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setRepoError(null);
    const owner = repoForm.owner.trim();
    const repoName = repoForm.repo.trim();
    const displayName = repoForm.displayName.trim();
    if (!owner || !repoName) {
      setRepoError("Enter both owner and repository name.");
      return;
    }
    const duplicate = store.repos.some(
      (repo) => repo.owner.trim().toLowerCase() === owner.toLowerCase() && repo.repo.trim().toLowerCase() === repoName.toLowerCase(),
    );
    if (duplicate) {
      setRepoError("Repository already linked.");
      return;
    }
    const entry = createRepoEntry(owner, repoName, displayName);
    setStore((prev) => ({ ...prev, repos: [...prev.repos, entry] }));
    setSelectedRepoId(entry.id);
    setSelectedProjectId(entry.projects[0]?.id ?? null);
    setRepoForm({ owner: "", repo: "", displayName: "" });
  };

  const removeRepository = (id: string) => {
    setStore((prev) => ({ ...prev, repos: prev.repos.filter((repo) => repo.id !== id) }));
    if (selectedRepoId === id) {
      setSelectedRepoId(null);
      setSelectedProjectId(null);
    }
  };

  const updateSelectedRepo = (updater: (repo: RepoSecrets) => RepoSecrets) => {
    if (!selectedRepo) return;
    setStore((prev) => ({
      ...prev,
      repos: prev.repos.map((repo) => {
        if (repo.id !== selectedRepo.id) return repo;
        const clone: RepoSecrets = {
          ...repo,
          projects: repo.projects.map((project) => ({ ...project })),
        };
        const updated = updater(clone);
        return {
          ...updated,
          projects: updated.projects.map((project) => ({ ...project })),
        };
      }),
    }));
  };

  const updateSelectedProject = (updater: (project: RepoProjectSecrets) => RepoProjectSecrets) => {
    if (!selectedRepo || !selectedProject) return;
    updateSelectedRepo((repo) => ({
      ...repo,
      projects: repo.projects.map((project) => (project.id === selectedProject.id ? updater({ ...project }) : project)),
    }));
  };

  const onRepoFieldChange = (field: "displayName" | "supabaseReadOnlyUrl" | "githubPat" | "openaiKey") =>
    (event: ChangeEvent<HTMLInputElement>) => {
      const value = event.target.value;
      updateSelectedRepo((repo) => ({ ...repo, [field]: value }));
    };

  const onProjectFieldChange = (field: "name" | "supabaseReadOnlyUrl" | "githubPat" | "openaiKey") =>
    (event: ChangeEvent<HTMLInputElement>) => {
      const value = event.target.value;
      updateSelectedProject((project) => ({ ...project, [field]: value }));
      if (field === "name") {
        setSelectedProjectId((prev) => prev);
      }
    };

  const addProject = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setProjectError(null);
    if (!selectedRepo) {
      setProjectError("Select a repository first.");
      return;
    }
    const name = projectForm.name.trim();
    if (!name) {
      setProjectError("Name your project before adding it.");
      return;
    }
    const existing = selectedRepo.projects.some((project) => project.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      setProjectError("Project already exists for this repository.");
      return;
    }
    const entry = createProjectEntry(name);
    updateSelectedRepo((repo) => ({ ...repo, projects: [...repo.projects, entry] }));
    setSelectedProjectId(entry.id);
    setProjectForm({ name: "" });
  };

  const removeProject = (id: string) => {
    if (!selectedRepo) return;
    const remaining = selectedRepo.projects.filter((project) => project.id !== id);
    updateSelectedRepo((repo) => ({ ...repo, projects: repo.projects.filter((project) => project.id !== id) }));
    if (selectedProjectId === id) {
      setSelectedProjectId(remaining[0]?.id ?? null);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);
    try {
      const normalized = normalizeSecretsForSave(store);
      const response = await fetch("/api/settings/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(normalized),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error((data as { error?: string })?.error || "Failed to save settings");
      }
      writeSecretsToStorage(normalized);
      setStore(normalized);
      const serialized = JSON.stringify(normalized);
      setInitialSerialized(serialized);
      setLastSaved(new Date().toISOString());
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Unable to save settings");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-6 py-10">
      <div className="space-y-3">
        <h1 className="text-3xl font-semibold text-slate-900">Secrets &amp; integrations</h1>
        <p className="max-w-3xl text-sm text-slate-600">
          Manage default API keys, connect repositories, and configure per-project Supabase probes. Credentials are stored in
          your browser for now and never leave your device.
        </p>
        <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
          <p className="font-medium text-slate-700">Heads up</p>
          <p>
            Values saved here are written to <code>localStorage</code>. Clearing your browser data removes them. Re-enter
            credentials on each device you use.
          </p>
        </div>
      </div>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <header className="space-y-1">
          <h2 className="text-xl font-medium text-slate-900">Global defaults</h2>
          <p className="text-sm text-slate-600">GitHub and OpenAI keys apply to every project unless you override them below.</p>
        </header>
        <div className="mt-6 grid gap-6 md:grid-cols-2">
          <label className="flex flex-col gap-2 text-sm font-medium text-slate-700">
            GitHub personal access token
            <input
              type="password"
              value={store.defaults.githubPat ?? ""}
              onChange={(event) =>
                setStore((prev) => ({
                  ...prev,
                  defaults: { ...prev.defaults, githubPat: event.target.value },
                }))
              }
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-200"
              placeholder="ghp_xxxxxxxxxxxxxxxxxxxxx"
            />
            <span className="text-xs font-normal text-slate-500">
              {defaultGithub ? "Default GitHub token detected." : "Required for committing roadmap artifacts."}
            </span>
          </label>
          <label className="flex flex-col gap-2 text-sm font-medium text-slate-700">
            OpenAI API key
            <input
              type="password"
              value={store.defaults.openaiKey ?? ""}
              onChange={(event) =>
                setStore((prev) => ({
                  ...prev,
                  defaults: { ...prev.defaults, openaiKey: event.target.value },
                }))
              }
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-200"
              placeholder="sk-..."
            />
            <span className="text-xs font-normal text-slate-500">
              {defaultOpenAi ? "Default OpenAI key detected." : "Add to enable brainstorming and roadmap generation."}
            </span>
          </label>
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="grid gap-8 lg:grid-cols-[260px,1fr]">
          <aside className="space-y-6">
            <div className="space-y-2">
              <h2 className="text-base font-semibold text-slate-900">Linked repositories</h2>
              <p className="text-xs text-slate-500">
                Add every repo you want the wizard to manage. Each repo can host multiple projects with their own Supabase
                probes and overrides.
              </p>
            </div>
            <div className="space-y-2">
              {store.repos.length ? (
                <ul className="space-y-2">
                  {store.repos.map((repo) => {
                    const isActive = repo.id === selectedRepoId;
                    const label = repo.displayName?.trim() || `${repo.owner}/${repo.repo}`;
                    return (
                      <li key={repo.id} className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedRepoId(repo.id);
                            setSelectedProjectId(repo.projects[0]?.id ?? null);
                          }}
                          className={`flex-1 rounded-md border px-3 py-2 text-left text-sm transition ${
                            isActive
                              ? "border-slate-900 bg-slate-900 text-white"
                              : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
                          }`}
                        >
                          {label}
                        </button>
                        <button
                          type="button"
                          onClick={() => removeRepository(repo.id)}
                          className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-500 hover:border-rose-300 hover:text-rose-500"
                          aria-label={`Remove ${repo.owner}/${repo.repo}`}
                        >
                          ×
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-sm text-slate-500">No repositories linked yet.</p>
              )}
            </div>
            <form onSubmit={addRepository} className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-sm font-medium text-slate-800">Add repository</p>
              <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
                Owner
                <input
                  value={repoForm.owner}
                  onChange={handleRepoFormChange("owner")}
                  placeholder="acme-co"
                  className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-500 focus:outline-none"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
                Repository
                <input
                  value={repoForm.repo}
                  onChange={handleRepoFormChange("repo")}
                  placeholder="product-app"
                  className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-500 focus:outline-none"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
                Display name (optional)
                <input
                  value={repoForm.displayName}
                  onChange={handleRepoFormChange("displayName")}
                  placeholder="Customer dashboard"
                  className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-500 focus:outline-none"
                />
              </label>
              {repoError ? <p className="text-xs text-rose-600">{repoError}</p> : null}
              <button
                type="submit"
                className="w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
              >
                Link repository
              </button>
            </form>
          </aside>

          <div className="space-y-8">
            {selectedRepo ? (
              <>
                <section className="space-y-4">
                  <header className="space-y-1">
                    <h3 className="text-lg font-semibold text-slate-900">{selectedRepo.displayName || `${selectedRepo.owner}/${selectedRepo.repo}`}</h3>
                    <p className="text-xs uppercase tracking-wide text-slate-500">Repository settings</p>
                  </header>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
                      Owner
                      <input
                        value={selectedRepo.owner}
                        readOnly
                        className="rounded-md border border-slate-200 bg-slate-100 px-3 py-2 text-sm text-slate-500"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
                      Repository
                      <input
                        value={selectedRepo.repo}
                        readOnly
                        className="rounded-md border border-slate-200 bg-slate-100 px-3 py-2 text-sm text-slate-500"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-xs font-medium text-slate-600 sm:col-span-2">
                      Display name (optional)
                      <input
                        value={selectedRepo.displayName ?? ""}
                        onChange={onRepoFieldChange("displayName")}
                        placeholder="Internal label"
                        className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-500 focus:outline-none"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-xs font-medium text-slate-600 sm:col-span-2">
                      Supabase read-only checks URL
                      <input
                        value={selectedRepo.supabaseReadOnlyUrl ?? ""}
                        onChange={onRepoFieldChange("supabaseReadOnlyUrl")}
                        placeholder="https://project.supabase.co/functions/v1/read-only-checks"
                        className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-500 focus:outline-none"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
                      GitHub PAT override (optional)
                      <input
                        type="password"
                        value={selectedRepo.githubPat ?? ""}
                        onChange={onRepoFieldChange("githubPat")}
                        placeholder="Override default token"
                        className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-500 focus:outline-none"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
                      OpenAI key override (optional)
                      <input
                        type="password"
                        value={selectedRepo.openaiKey ?? ""}
                        onChange={onRepoFieldChange("openaiKey")}
                        placeholder="Override default key"
                        className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-500 focus:outline-none"
                      />
                    </label>
                  </div>
                </section>

                <section className="space-y-4">
                  <header className="flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <h4 className="text-base font-semibold text-slate-900">Projects in this repo</h4>
                      <p className="text-xs text-slate-500">
                        Link Supabase probes or override keys per project. Leave blank to inherit repo defaults.
                      </p>
                    </div>
                    {repoResolved?.supabaseReadOnlyUrl ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-700">
                        Using {supabaseSourceLabel ?? "configured"} probe
                      </span>
                    ) : null}
                  </header>

                  {selectedRepo.projects.length ? (
                    <div className="flex flex-wrap gap-2">
                      {selectedRepo.projects.map((project) => {
                        const isActive = project.id === selectedProjectId;
                        return (
                          <button
                            key={project.id}
                            type="button"
                            onClick={() => setSelectedProjectId(project.id)}
                            className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                              isActive
                                ? "border-slate-900 bg-slate-900 text-white"
                                : "border-slate-300 bg-white text-slate-600 hover:border-slate-400"
                            }`}
                          >
                            {project.name}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-sm text-slate-500">No projects yet — add one below.</p>
                  )}

                  {selectedProject ? (
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5 space-y-4">
                      <div className="flex items-center justify-between">
                        <h5 className="text-sm font-semibold text-slate-900">{selectedProject.name}</h5>
                        <button
                          type="button"
                          onClick={() => removeProject(selectedProject.id)}
                          className="text-xs font-medium text-rose-500 hover:text-rose-400"
                        >
                          Remove project
                        </button>
                      </div>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <label className="flex flex-col gap-1 text-xs font-medium text-slate-600 sm:col-span-2">
                          Project name
                          <input
                            value={selectedProject.name}
                            onChange={onProjectFieldChange("name")}
                            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-500 focus:outline-none"
                          />
                        </label>
                        <label className="flex flex-col gap-1 text-xs font-medium text-slate-600 sm:col-span-2">
                          Supabase read-only checks URL
                          <input
                            value={selectedProject.supabaseReadOnlyUrl ?? ""}
                            onChange={onProjectFieldChange("supabaseReadOnlyUrl")}
                            placeholder="https://.../read-only-checks"
                            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-500 focus:outline-none"
                          />
                        </label>
                        <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
                          GitHub PAT override
                          <input
                            type="password"
                            value={selectedProject.githubPat ?? ""}
                            onChange={onProjectFieldChange("githubPat")}
                            placeholder="Inherit repo default"
                            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-500 focus:outline-none"
                          />
                        </label>
                        <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
                          OpenAI key override
                          <input
                            type="password"
                            value={selectedProject.openaiKey ?? ""}
                            onChange={onProjectFieldChange("openaiKey")}
                            placeholder="Inherit repo default"
                            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-500 focus:outline-none"
                          />
                        </label>
                      </div>
                    </div>
                  ) : null}

                  <form onSubmit={addProject} className="space-y-3 rounded-2xl border border-dashed border-slate-300 p-5">
                    <p className="text-sm font-semibold text-slate-800">Add project</p>
                    <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
                      Project name
                      <input
                        value={projectForm.name}
                        onChange={handleProjectFormChange}
                        placeholder="Growth experiments"
                        className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-500 focus:outline-none"
                      />
                    </label>
                    {projectError ? <p className="text-xs text-rose-600">{projectError}</p> : null}
                    <button
                      type="submit"
                      className="inline-flex items-center justify-center rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
                    >
                      Add project
                    </button>
                  </form>
                </section>
              </>
            ) : (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-8 text-sm text-slate-600">
                Link a repository to configure per-project secrets.
              </div>
            )}
          </div>
        </div>
      </section>

      {error ? <p className="text-sm text-rose-600">{error}</p> : lastSaved ? <p className="text-sm text-emerald-600">Saved locally at {new Date(lastSaved).toLocaleTimeString()}.</p> : null}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={isSaving || !hasChanges}
          className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
        >
          {isSaving ? "Saving" : "Save secrets"}
        </button>
        {!hasChanges && !isSaving ? <span className="text-xs text-slate-500">No changes to save.</span> : null}
      </div>
    </div>
  );
}
