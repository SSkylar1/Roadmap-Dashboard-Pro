"use client";

import { ChangeEvent, FormEvent, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import StatusGrid from "@/components/StatusGrid";
import { STANDALONE_MODE } from "@/lib/config";
import { fetchContextPack, type ContextPackPayload } from "@/lib/context-pack";
import { describeProjectFile, normalizeProjectKey } from "@/lib/project-paths";
import { mergeProjectOptions } from "@/lib/project-options";
import { removeProjectFromStore, removeRepoFromStore } from "@/lib/secrets-actions";
import { ROADMAP_HANDOFF_KEY, type RoadmapWizardHandOffPayload } from "@/lib/wizard-handoff";
import { resolveSecrets, useLocalSecrets } from "@/lib/use-local-secrets";

type ErrorState = { title: string; detail?: string } | null;

type RunResponse = {
  ok?: boolean;
  wrote?: string[];
  error?: string;
  detail?: string;
  snapshot?: Record<string, any> | null;
  meta?: {
    id?: string;
    workspace_id?: string | null;
    project_id?: string | null;
    branch?: string | null;
    created_at?: string;
  };
};

type BacklogItem = {
  id: string;
  title: string;
  status: string;
};

type DiscoverConfig = {
  db_queries: string[];
  code_globs: string[];
  notes?: string[];
};

type ProbeResult = { q: string; ok: boolean; why?: string };

type DiscoverResponse = {
  ok?: boolean;
  discovered?: number;
  items?: BacklogItem[];
  wrote?: string[];
  error?: string;
  detail?: string;
  config?: DiscoverConfig;
  db?: ProbeResult[];
  code_matches?: string[];
};

type RoadmapStatus = {
  generated_at?: string;
  weeks?: any[];
};

const ADD_NEW_REPO_OPTION = "__add_new_repo__";
const ADD_NEW_PROJECT_OPTION = "__add_new_project__";

const STANDALONE_CONTEXT_NOTICE =
  "Standalone mode exports the dashboard hand-off bundle from this browser's in-memory workspace without reaching GitHub.";

function MidProjectSyncWorkspaceInner() {
  const [owner, setOwner] = useState("");
  const [repo, setRepo] = useState("");
  const [branch, setBranch] = useState("main");
  const [probeUrl, setProbeUrl] = useState("");
  const [selectedRepoId, setSelectedRepoId] = useState<string>(ADD_NEW_REPO_OPTION);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [projectSelectValue, setProjectSelectValue] = useState<string>("");
  const [discoveredProjectSlugs, setDiscoveredProjectSlugs] = useState<string[]>([]);
  const [projectSlugsLoading, setProjectSlugsLoading] = useState(false);
  const [projectSlugsError, setProjectSlugsError] = useState<string | null>(null);
  const [projectOverride, setProjectOverride] = useState("");
  const [probeCustomized, setProbeCustomized] = useState(false);
  const [bootstrapped, setBootstrapped] = useState(false);
  const [handoffPrefillApplied, setHandoffPrefillApplied] = useState(false);
  const [isRemovingRepo, setIsRemovingRepo] = useState(false);
  const [removeRepoError, setRemoveRepoError] = useState<string | null>(null);
  const [isRemovingProject, setIsRemovingProject] = useState(false);
  const [removeProjectError, setRemoveProjectError] = useState<string | null>(null);

  const [status, setStatus] = useState<RoadmapStatus | null>(null);
  const [backlog, setBacklog] = useState<BacklogItem[]>([]);
  const [runArtifacts, setRunArtifacts] = useState<string[]>([]);
  const [discoverArtifacts, setDiscoverArtifacts] = useState<string[]>([]);
  const [discoverConfig, setDiscoverConfig] = useState<DiscoverConfig | null>(
    STANDALONE_MODE
      ? {
          db_queries: [],
          code_globs: [],
          notes: ["Standalone mode keeps discovery results local to this browser session."],
        }
      : null,
  );
  const [dbProbes, setDbProbes] = useState<ProbeResult[]>([]);
  const [codeMatches, setCodeMatches] = useState<string[]>([]);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [lastDiscoveryAt, setLastDiscoveryAt] = useState<string | null>(null);

  const [error, setError] = useState<ErrorState>(null);
  const [contextError, setContextError] = useState<ErrorState>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const [contextPack, setContextPack] = useState<ContextPackPayload | null>(null);
  const [contextWarning, setContextWarning] = useState<string | null>(
    STANDALONE_MODE ? STANDALONE_CONTEXT_NOTICE : null,
  );
  const secretsStore = useLocalSecrets();
  const params = useSearchParams();

  const trimmedOwner = owner.trim();
  const trimmedRepo = repo.trim();

  const repoOptions = secretsStore.repos;
  const matchedRepoEntry = useMemo(() => {
    if (selectedRepoId && selectedRepoId !== ADD_NEW_REPO_OPTION) {
      return repoOptions.find((entry) => entry.id === selectedRepoId) ?? null;
    }
    if (trimmedOwner && trimmedRepo) {
      return (
        repoOptions.find(
          (entry) =>
            entry.owner.trim().toLowerCase() === trimmedOwner.toLowerCase() &&
            entry.repo.trim().toLowerCase() === trimmedRepo.toLowerCase(),
        ) ?? null
      );
    }
    return null;
  }, [repoOptions, selectedRepoId, trimmedOwner, trimmedRepo]);
  const projectOptions = useMemo(
    () => mergeProjectOptions(matchedRepoEntry?.projects, discoveredProjectSlugs),
    [matchedRepoEntry?.projects, discoveredProjectSlugs],
  );

  const normalizedDiscoveredProjectKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const slug of discoveredProjectSlugs) {
      const normalized = normalizeProjectKey(slug);
      if (normalized) {
        keys.add(normalized);
      }
    }
    return keys;
  }, [discoveredProjectSlugs]);

  const selectedProjectMeta = useMemo(
    () => projectOptions.find((project) => project.id === selectedProjectId) ?? null,
    [projectOptions, selectedProjectId],
  );

  const resolvedSecrets = useMemo(
    () => resolveSecrets(secretsStore, trimmedOwner, trimmedRepo, selectedProjectId || undefined),
    [secretsStore, trimmedOwner, trimmedRepo, selectedProjectId],
  );

  const normalizedOverrideKey = normalizeProjectKey(projectOverride);
  const normalizedSelectedId = normalizeProjectKey(selectedProjectId);
  const selectedProjectSlug = selectedProjectMeta?.slug;
  const slugConfirmed =
    !!selectedProjectSlug &&
    (selectedProjectMeta?.source === "repo" || normalizedDiscoveredProjectKeys.has(selectedProjectSlug));
  const projectKey = normalizedOverrideKey ?? (slugConfirmed ? selectedProjectSlug : undefined) ?? normalizedSelectedId;
  const roadmapPath = describeProjectFile("docs/roadmap.yml", projectKey);
  const projectPlanPath = describeProjectFile("docs/project-plan.md", projectKey);
  const statusPath = describeProjectFile("docs/roadmap-status.json", projectKey);
  const discoverPath = describeProjectFile("docs/discover.yml", projectKey);
  const backlogPath = describeProjectFile("docs/backlog-discovered.yml", projectKey);
  const summaryPath = describeProjectFile("docs/summary.txt", projectKey);

  useEffect(() => {
    if (!STANDALONE_MODE) {
      return;
    }
    const desiredNotes = [
      "Standalone mode keeps discovery results in memory only.",
      `Manually curate ${backlogPath} after each sync to capture completed work.`,
    ];
    setDiscoverConfig((current) => {
      const currentNotes = current?.notes ?? [];
      const sameNotes =
        currentNotes.length === desiredNotes.length &&
        currentNotes.every((note, index) => note === desiredNotes[index]);
      const hasQueries = Boolean(current?.db_queries?.length || current?.code_globs?.length);
      if (sameNotes && !hasQueries) {
        return current;
      }
      return { db_queries: [], code_globs: [], notes: desiredNotes };
    });
  }, [backlogPath]);

  const describeSource = (source?: "project" | "repo" | "default") => {
    if (!source) return null;
    if (source === "project") return "project override";
    if (source === "repo") return "repo default";
    return "global default";
  };

  const githubReady = Boolean(resolvedSecrets.githubPat);
  const supabaseReady = Boolean(resolvedSecrets.supabaseReadOnlyUrl);
  const githubSourceLabel = describeSource(resolvedSecrets.sources.githubPat);
  const supabaseSourceLabel = describeSource(resolvedSecrets.sources.supabaseReadOnlyUrl);

  const projectSlug = projectKey ?? null;
  const repoSlug = trimmedOwner && trimmedRepo ? `${trimmedOwner}/${trimmedRepo}` : null;
  const dashboardHref = useMemo(() => {
    if (!trimmedOwner || !trimmedRepo) {
      return null;
    }
    const params = new URLSearchParams();
    params.set("owner", trimmedOwner);
    params.set("repo", trimmedRepo);
    if (projectSlug) {
      params.set("project", projectSlug);
    }
    return `/dashboard?${params.toString()}`;
  }, [trimmedOwner, trimmedRepo, projectSlug]);

  const canSubmit = Boolean(!isSyncing && repoSlug);
  const canDiscover = Boolean(!STANDALONE_MODE && !isDiscovering && !isSyncing && repoSlug);
  const branchParam = branch.trim() || "main";

  useEffect(() => {
    if (!trimmedOwner || !trimmedRepo) {
      setDiscoveredProjectSlugs([]);
      setProjectSlugsError(null);
      setProjectSlugsLoading(false);
      return;
    }

    if (STANDALONE_MODE) {
      setDiscoveredProjectSlugs([]);
      setProjectSlugsError(null);
      setProjectSlugsLoading(false);
      return;
    }

    const controller = new AbortController();
    let cancelled = false;
    setProjectSlugsLoading(true);
    setProjectSlugsError(null);

    const headers: HeadersInit = {};
    if (resolvedSecrets.githubPat && resolvedSecrets.sources.githubPat) {
      headers["x-github-pat"] = resolvedSecrets.githubPat;
    }

    fetch(
      `/api/projects/${encodeURIComponent(trimmedOwner)}/${encodeURIComponent(trimmedRepo)}?branch=${encodeURIComponent(branchParam)}`,
      {
        cache: "no-store",
        signal: controller.signal,
        headers,
      },
    )
      .then(async (response) => {
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          const message = body?.error || response.statusText || "Failed to load project slugs";
          throw new Error(message);
        }
        return response.json();
      })
      .then((json: { projects?: Array<{ slug?: string }> }) => {
        if (cancelled) return;
        const slugs = Array.isArray(json?.projects)
          ? json.projects
              .map((project) => (typeof project?.slug === "string" ? project.slug.trim() : ""))
              .filter((slug) => slug.length > 0)
          : [];
        setDiscoveredProjectSlugs(slugs);
        setProjectSlugsLoading(false);
      })
      .catch((fetchError) => {
        if (cancelled) return;
        setDiscoveredProjectSlugs([]);
        setProjectSlugsError(String(fetchError?.message || fetchError));
        setProjectSlugsLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [trimmedOwner, trimmedRepo, branchParam, resolvedSecrets.githubPat, resolvedSecrets.sources.githubPat]);

  useEffect(() => {
    if (handoffPrefillApplied) {
      return;
    }

    const paramOwner = params.get("owner")?.trim() ?? "";
    const paramRepo = params.get("repo")?.trim() ?? "";
    const paramProject = params.get("project")?.trim() ?? "";
    const paramBranch = params.get("branch")?.trim() ?? "";

    let stored: RoadmapWizardHandOffPayload | null = null;
    if (typeof window !== "undefined") {
      try {
        const raw = window.localStorage.getItem(ROADMAP_HANDOFF_KEY);
        stored = raw ? (JSON.parse(raw) as RoadmapWizardHandOffPayload) : null;
      } catch (err) {
        console.error("Failed to read roadmap handoff for mid-project workspace", err);
      }
    }

    const storedOwner = stored?.owner?.trim() ?? "";
    const storedRepo = stored?.repo?.trim() ?? "";
    const storedProject =
      typeof stored?.project === "string" ? stored.project.trim() : "";
    const storedPromotedBranch =
      typeof stored?.promotedBranch === "string" ? stored.promotedBranch.trim() : "";
    const storedBranch =
      typeof stored?.branch === "string" ? stored.branch.trim() : "";

    const nextOwner = paramOwner || storedOwner;
    const nextRepo = paramRepo || storedRepo;
    const nextProject = paramProject || storedProject;
    const resolvedBranchInput = paramBranch || storedPromotedBranch || storedBranch || branch;
    const resolvedBranch = resolvedBranchInput.trim() || "main";

    if (nextOwner && !owner) {
      setOwner(nextOwner);
    }
    if (nextRepo && !repo) {
      setRepo(nextRepo);
    }
    if (nextProject) {
      const normalizedProject = normalizeProjectKey(nextProject);
      if (normalizedProject) {
        if (!projectOverride || projectOverride !== normalizedProject) {
          setProjectOverride(normalizedProject);
        }
      } else if (projectOverride) {
        setProjectOverride("");
      }
      if (projectSelectValue !== ADD_NEW_PROJECT_OPTION) {
        setProjectSelectValue(ADD_NEW_PROJECT_OPTION);
      }
      if (selectedProjectId) {
        setSelectedProjectId("");
      }
    }

    setBranch(resolvedBranch);
    setHandoffPrefillApplied(true);
  }, [
    handoffPrefillApplied,
    owner,
    params,
    projectOverride,
    projectSelectValue,
    repo,
    selectedProjectId,
    branch,
  ]);

  useEffect(() => {
    if (!handoffPrefillApplied) {
      return;
    }
    if (bootstrapped) return;
    if (!owner && !repo && repoOptions.length) {
      const first = repoOptions[0];
      setSelectedRepoId(first.id);
      setOwner(first.owner);
      setRepo(first.repo);
      const firstProjectId = first.projects[0]?.id ?? "";
      setSelectedProjectId(firstProjectId);
      setProjectSelectValue(firstProjectId || "");
      setProjectOverride("");
      setBootstrapped(true);
    } else if (owner || repo) {
      setSelectedRepoId(ADD_NEW_REPO_OPTION);
      setProjectSelectValue(projectOverride ? ADD_NEW_PROJECT_OPTION : "");
      setBootstrapped(true);
    }
  }, [bootstrapped, handoffPrefillApplied, owner, projectOverride, repo, repoOptions]);

  useEffect(() => {
    if (!handoffPrefillApplied) {
      return;
    }
    if (!owner || !repo || !repoOptions.length) {
      return;
    }

    const trimmedOwner = owner.trim().toLowerCase();
    const trimmedRepo = repo.trim().toLowerCase();
    const matchedRepoEntry =
      repoOptions.find(
        (entry) =>
          entry.owner.trim().toLowerCase() === trimmedOwner &&
          entry.repo.trim().toLowerCase() === trimmedRepo,
      ) ?? null;

    if (!matchedRepoEntry) {
      return;
    }

    if (selectedRepoId !== matchedRepoEntry.id) {
      setSelectedRepoId(matchedRepoEntry.id);
      setOwner(matchedRepoEntry.owner);
      setRepo(matchedRepoEntry.repo);
    }

    if (projectOverride) {
      const normalizedOverride = normalizeProjectKey(projectOverride);
      const existingProject =
        matchedRepoEntry.projects.find((project) => project.id === normalizedOverride) ?? null;
      if (existingProject) {
        setProjectOverride("");
        setSelectedProjectId(existingProject.id);
        setProjectSelectValue(existingProject.id);
      }
    }
  }, [handoffPrefillApplied, owner, projectOverride, repo, repoOptions, selectedRepoId]);

  useEffect(() => {
    if (projectSelectValue === ADD_NEW_PROJECT_OPTION) {
      return;
    }
    if (!projectOptions.length) {
      if (selectedProjectId) {
        setSelectedProjectId("");
      }
      setProjectSelectValue("");
      setProjectOverride("");
      return;
    }
    if (selectedProjectId && projectOptions.some((project) => project.id === selectedProjectId)) {
      setProjectSelectValue(selectedProjectId);
      return;
    }
    const first = projectOptions[0]?.id ?? "";
    setSelectedProjectId(first);
    setProjectSelectValue(first || "");
    setProjectOverride("");
  }, [projectOptions, projectSelectValue, selectedProjectId]);

  useEffect(() => {
    setProbeCustomized(false);
  }, [selectedRepoId, selectedProjectId]);

  useEffect(() => {
    setRemoveRepoError(null);
  }, [selectedRepoId, matchedRepoEntry?.id]);

  useEffect(() => {
    setRemoveProjectError(null);
  }, [selectedProjectId, matchedRepoEntry?.id]);

  useEffect(() => {
    if (!probeCustomized && resolvedSecrets.supabaseReadOnlyUrl) {
      setProbeUrl(resolvedSecrets.supabaseReadOnlyUrl);
    }
  }, [probeCustomized, resolvedSecrets.supabaseReadOnlyUrl]);

  const handleRepoSelect = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      const value = event.target.value;
      if (value === ADD_NEW_REPO_OPTION) {
        setSelectedRepoId(ADD_NEW_REPO_OPTION);
        setSelectedProjectId("");
        setProjectSelectValue("");
        setProjectOverride("");
        return;
      }
      const entry = repoOptions.find((option) => option.id === value);
      if (!entry) return;
      setSelectedRepoId(entry.id);
      setOwner(entry.owner);
      setRepo(entry.repo);
      const firstProjectId = entry.projects[0]?.id ?? "";
      setSelectedProjectId(firstProjectId);
      setProjectSelectValue(firstProjectId || "");
      setProjectOverride("");
    },
    [repoOptions],
  );

  const handleProjectSelect = useCallback((event: ChangeEvent<HTMLSelectElement>) => {
    const value = event.target.value;
    setProjectSelectValue(value);
    if (!value) {
      setSelectedProjectId("");
      setProjectOverride("");
      return;
    }
    if (value === ADD_NEW_PROJECT_OPTION) {
      setSelectedProjectId("");
      setProjectOverride("");
      return;
    }
    setSelectedProjectId(value);
    setProjectOverride("");
  }, []);

  const handleRemoveRepo = useCallback(async () => {
    if (!matchedRepoEntry) {
      return;
    }
    if (!window.confirm(`Remove ${matchedRepoEntry.owner}/${matchedRepoEntry.repo} from the dashboard?`)) {
      return;
    }
    setIsRemovingRepo(true);
    setRemoveRepoError(null);
    try {
      await removeRepoFromStore(secretsStore, matchedRepoEntry.id);
      setOwner("");
      setRepo("");
      setSelectedRepoId(ADD_NEW_REPO_OPTION);
      setSelectedProjectId("");
      setProjectSelectValue("");
      setProjectOverride("");
    } catch (removeError) {
      setRemoveRepoError(
        removeError instanceof Error ? removeError.message : String(removeError ?? "Failed to remove repository"),
      );
    } finally {
      setIsRemovingRepo(false);
    }
  }, [matchedRepoEntry, secretsStore]);

  const handleRemoveProject = useCallback(async () => {
    if (!matchedRepoEntry || !selectedProjectMeta || selectedProjectMeta.source !== "stored") {
      return;
    }
    const projectEntry = matchedRepoEntry.projects.find((project) => project.id === selectedProjectMeta.id);
    if (!projectEntry) {
      return;
    }
    if (
      !window.confirm(
        `Remove project ${projectEntry.name} from ${matchedRepoEntry.owner}/${matchedRepoEntry.repo}?`,
      )
    ) {
      return;
    }
    setIsRemovingProject(true);
    setRemoveProjectError(null);
    try {
      await removeProjectFromStore(secretsStore, matchedRepoEntry.id, projectEntry.id);
      setSelectedProjectId("");
      setProjectSelectValue("");
      setProjectOverride("");
    } catch (removeError) {
      setRemoveProjectError(
        removeError instanceof Error ? removeError.message : String(removeError ?? "Failed to remove project"),
      );
    } finally {
      setIsRemovingProject(false);
    }
  }, [matchedRepoEntry, secretsStore, selectedProjectMeta]);

  const handleProbeChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setProbeCustomized(true);
    setProbeUrl(event.target.value);
  }, []);

  const resetProbeToDefault = useCallback(() => {
    setProbeCustomized(false);
    if (resolvedSecrets.supabaseReadOnlyUrl) {
      setProbeUrl(resolvedSecrets.supabaseReadOnlyUrl);
    } else {
      setProbeUrl("");
    }
  }, [resolvedSecrets.supabaseReadOnlyUrl]);

  async function handleSync(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!repoSlug) {
      setError({ title: "Provide owner and repository", detail: "Fill both fields before connecting." });
      return;
    }

    setIsSyncing(true);
    setError(null);
    setStatus(null);
    setBacklog([]);
    setRunArtifacts([]);
    setDiscoverArtifacts([]);
    setDiscoverConfig(null);
    setDbProbes([]);
    setCodeMatches([]);
    setContextPack(null);
    setContextError(null);
    setLastSyncedAt(null);
    setLastDiscoveryAt(null);

    const payload = {
      owner: owner.trim(),
      repo: repo.trim(),
      branch: branchParam,
      ...(probeUrl.trim() ? { probeUrl: probeUrl.trim() } : {}),
      ...(projectKey ? { project: projectKey } : {}),
    };

    try {
      const runHeaders: HeadersInit = { "Content-Type": "application/json" };
      if (resolvedSecrets.githubPat) {
        runHeaders["x-github-pat"] = resolvedSecrets.githubPat;
      }
      if (resolvedSecrets.openaiKey) {
        runHeaders["x-openai-key"] = resolvedSecrets.openaiKey;
      }

      const runResponse = await fetch("/api/run", {
        method: "POST",
        headers: runHeaders,
        body: JSON.stringify(payload),
      });
      const runJson = (await runResponse.json()) as RunResponse;
      if (!runResponse.ok || runJson?.ok === false || runJson?.error) {
        throw new Error(runJson?.error || "Failed to refresh roadmap status");
      }
      setRunArtifacts(runJson?.wrote ?? []);

      const statusHeaders: HeadersInit = resolvedSecrets.githubPat
        ? { "x-github-pat": resolvedSecrets.githubPat }
        : {};
      const statusProjectQuery = projectKey ? `&project=${encodeURIComponent(projectKey)}` : "";
      const statusResponse = await fetch(
        `/api/status/${payload.owner}/${payload.repo}?branch=${encodeURIComponent(payload.branch)}${statusProjectQuery}`,
        { cache: "no-store", headers: statusHeaders },
      );
      if (statusResponse.ok) {
        const statusJson = (await statusResponse.json()) as RoadmapStatus;
        setStatus(statusJson);
      } else {
        setStatus(null);
      }

      await runDiscovery(payload);

      const nowIso = new Date().toISOString();
      setLastSyncedAt(nowIso);
    } catch (err: any) {
      setError({
        title: "Sync failed",
        detail: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setIsSyncing(false);
    }
  }

  const statusGeneratedAt = status?.generated_at
    ? new Date(status.generated_at).toLocaleString()
    : lastSyncedAt
    ? new Date(lastSyncedAt).toLocaleString()
    : null;

  const discoveryGeneratedAt = lastDiscoveryAt
    ? new Date(lastDiscoveryAt).toLocaleString()
    : null;

  const seededDiscover = useMemo(
    () => (discoverPath ? discoverArtifacts.some((path) => path.startsWith(discoverPath)) : false),
    [discoverArtifacts, discoverPath],
  );

  const contextGeneratedAt = contextPack?.generated_at
    ? new Date(contextPack.generated_at).toLocaleString()
    : null;
  const contextJson = useMemo(
    () => (contextPack ? JSON.stringify(contextPack, null, 2) : null),
    [contextPack],
  );
  const contextFiles = useMemo(() => Object.keys(contextPack?.files ?? {}), [contextPack]);

  const runDiscovery = useCallback(
    async (payload: { owner: string; repo: string; branch: string; probeUrl?: string; project?: string }) => {
      if (STANDALONE_MODE) {
        const nowIso = new Date().toISOString();
        setDiscoverArtifacts([]);
        setBacklog([]);
        setDbProbes([]);
        setCodeMatches([]);
        setLastDiscoveryAt(nowIso);
        setDiscoverConfig({
          db_queries: [],
          code_globs: [],
          notes: [
            "Standalone mode skips GitHub discovery runs.",
            `Capture completed work manually in ${backlogPath}.`,
          ],
        });
        return;
      }

      const discoverHeaders: HeadersInit = { "Content-Type": "application/json" };
      if (resolvedSecrets.githubPat) {
        discoverHeaders["x-github-pat"] = resolvedSecrets.githubPat;
      }
      const discoverResponse = await fetch("/api/discover", {
        method: "POST",
        headers: discoverHeaders,
        body: JSON.stringify(payload),
      });
      const discoverJson = (await discoverResponse.json()) as DiscoverResponse;
      setDiscoverArtifacts(discoverJson?.wrote ?? []);
      setBacklog(discoverJson?.items ?? []);
      setDiscoverConfig(discoverJson?.config ?? null);
      setDbProbes(discoverJson?.db ?? []);
      setCodeMatches(discoverJson?.code_matches ?? []);
      const nowIso = new Date().toISOString();
      setLastDiscoveryAt(nowIso);
      if (!discoverResponse.ok || discoverJson?.ok === false || discoverJson?.error) {
        throw new Error(discoverJson?.detail || discoverJson?.error || "Discover run failed");
      }
    },
    [backlogPath, resolvedSecrets.githubPat],
  );

  const handleDiscoverOnly = useCallback(async () => {
    if (!repoSlug) {
      setError({
        title: "Provide owner and repository",
        detail: "Fill both fields before running discovery.",
      });
      return;
    }

    const payload = {
      owner: owner.trim(),
      repo: repo.trim(),
      branch: branchParam,
      ...(probeUrl.trim() ? { probeUrl: probeUrl.trim() } : {}),
      ...(projectKey ? { project: projectKey } : {}),
    };

    setIsDiscovering(true);
    setError(null);
    setDiscoverArtifacts([]);
    setBacklog([]);
    setDiscoverConfig(null);
    setDbProbes([]);
    setCodeMatches([]);
    setLastDiscoveryAt(null);

    try {
      await runDiscovery(payload);
    } catch (err: any) {
      setError({
        title: "Discovery failed",
        detail: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setIsDiscovering(false);
    }
  }, [branchParam, owner, probeUrl, projectKey, repo, repoSlug, runDiscovery]);

  const handleExportContext = useCallback(async () => {
    if (!repoSlug) {
      setContextError({
        title: "Provide owner and repository",
        detail: "Fill the owner, repository, and branch before exporting the dashboard hand-off bundle.",
      });
      return;
    }

    const trimmedOwner = owner.trim();
    const trimmedRepo = repo.trim();
    const trimmedBranch = branchParam;

    setContextError(null);
    setContextPack(null);
    setIsExporting(true);
    if (STANDALONE_MODE) {
      setContextWarning(STANDALONE_CONTEXT_NOTICE);
    } else {
      setContextWarning(null);
    }

    try {
      const payload = await fetchContextPack(
        {
          owner: trimmedOwner,
          repo: trimmedRepo,
          branch: trimmedBranch,
          project: projectKey || null,
          githubPat: resolvedSecrets.githubPat ?? null,
        },
        fetch,
      );
      if (payload?.source === "standalone") {
        setContextWarning(STANDALONE_CONTEXT_NOTICE);
      } else if (!STANDALONE_MODE) {
        setContextWarning(null);
      }
      setContextPack(payload);
    } catch (err: any) {
      setContextError({
        title: "Export failed",
        detail: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setIsExporting(false);
    }
  }, [branchParam, owner, projectKey, repo, repoSlug, resolvedSecrets.githubPat]);

  const handleDownloadContext = useCallback(() => {
    if (!contextPack) return;
    const filename = `${(repoSlug ?? "context-pack").replace(/\//g, "-")}.context-pack.json`;
    const blob = new Blob([JSON.stringify(contextPack, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [contextPack, repoSlug]);

  return (
    <div className="tw-space-y-10">
      <div>
        <Link
          href="/wizard/mid-build"
          className="tw-inline-flex tw-items-center tw-gap-2 tw-rounded-full tw-border tw-border-slate-800 tw-bg-slate-950 tw-px-3 tw-py-1 tw-text-xs tw-font-medium tw-uppercase tw-tracking-wide tw-text-slate-300 hover:tw-border-slate-700 hover:tw-text-slate-100"
        >
          <span aria-hidden="true">←</span>
          <span>Back to mid-project playbook</span>
        </Link>
      </div>

      <header className="tw-space-y-3">
        <span className="tw-inline-flex tw-items-center tw-gap-2 tw-rounded-full tw-border tw-border-slate-800 tw-px-3 tw-py-1 tw-text-xs tw-font-medium tw-uppercase tw-tracking-wide tw-text-slate-300">
          Mid-project sync
        </span>
        <h1 className="tw-text-3xl tw-font-bold tw-leading-tight tw-text-slate-100">Refresh live project context</h1>
        <p className="tw-text-base tw-leading-relaxed tw-text-slate-300">
          Connect an active repository to regenerate roadmap status and discovery insights before diving into the full dashboard.
        </p>
        <div className="tw-flex tw-flex-wrap tw-gap-3 tw-text-xs tw-font-medium tw-uppercase tw-tracking-wide tw-text-slate-400">
          {!STANDALONE_MODE ? (
            <span>
              {githubReady
                ? `GitHub token ready (${githubSourceLabel ?? "global default"})`
                : "Add a GitHub PAT in Settings"}
            </span>
          ) : (
            <span>Standalone Mode: GitHub syncing is optional and currently disabled.</span>
          )}
          <span>
            {supabaseReady
              ? `Supabase probe ready (${supabaseSourceLabel ?? "global default"})`
              : "Optional: add a Supabase probe in Settings"}
          </span>
        </div>
        {STANDALONE_MODE ? (
          <div className="tw-rounded-2xl tw-border tw-border-amber-500/30 tw-bg-amber-500/10 tw-p-4 tw-text-sm tw-text-amber-100">
            <div className="tw-font-semibold">Standalone mode active</div>
            <p className="tw-mt-1 tw-text-amber-100/80">
              Status runs stay in-memory. Discovery scans require GitHub, while dashboard exports synthesize the AI hand-off bundle from the standalone workspace.
            </p>
          </div>
        ) : null}
      </header>
      <>
          <form onSubmit={handleSync} className="tw-grid tw-gap-8 lg:tw-grid-cols-[1.4fr,1fr]">
        <section className="tw-space-y-6 tw-rounded-3xl tw-border tw-border-slate-800 tw-bg-slate-900 tw-p-8">
          <div className="tw-grid tw-gap-4 md:tw-grid-cols-2">
            <label className="tw-flex tw-flex-col tw-gap-2 md:tw-col-span-2">
              <span className="tw-text-sm tw-font-medium tw-text-slate-200">Linked repository</span>
              <select
                value={selectedRepoId}
                onChange={handleRepoSelect}
                className="tw-w-full tw-rounded-xl tw-border tw-border-slate-700 tw-bg-slate-950 tw-px-3 tw-py-2 tw-text-sm tw-text-slate-100 focus:tw-border-slate-500 focus:tw-outline-none"
              >
                <option value={ADD_NEW_REPO_OPTION}>Add new repo…</option>
                {repoOptions.map((option) => {
                  const label = option.displayName?.trim() || `${option.owner}/${option.repo}`;
                  return (
                    <option key={option.id} value={option.id}>
                      {label}
                    </option>
                  );
                })}
              </select>
              {matchedRepoEntry && selectedRepoId !== ADD_NEW_REPO_OPTION ? (
                <div className="tw-flex tw-flex-wrap tw-items-center tw-gap-3 tw-pt-1">
                  <button
                    type="button"
                    onClick={handleRemoveRepo}
                    disabled={isRemovingRepo}
                    className="tw-text-[11px] tw-font-semibold tw-uppercase tw-tracking-wide tw-text-rose-300 hover:tw-text-rose-100"
                  >
                    {isRemovingRepo ? "Removing…" : "Remove repo"}
                  </button>
                  {removeRepoError ? (
                    <span className="tw-text-[11px] tw-text-rose-300">{removeRepoError}</span>
                  ) : null}
                </div>
              ) : null}
            </label>
            {selectedRepoId === ADD_NEW_REPO_OPTION && (
              <>
                <label className="tw-flex tw-flex-col tw-gap-2">
                  <span className="tw-text-sm tw-font-medium tw-text-slate-200">Owner</span>
                  <input
                    value={owner}
                    onChange={(event) => {
                      setOwner(event.target.value);
                      setSelectedRepoId(ADD_NEW_REPO_OPTION);
                    }}
                    placeholder="acme-co"
                    className="tw-w-full tw-rounded-xl tw-border tw-border-slate-700 tw-bg-slate-950 tw-px-3 tw-py-2 tw-text-sm tw-text-slate-100 tw-placeholder-slate-500 focus:tw-border-slate-500 focus:tw-outline-none"
                  />
                </label>
                <label className="tw-flex tw-flex-col tw-gap-2">
                  <span className="tw-text-sm tw-font-medium tw-text-slate-200">Repository</span>
                  <input
                    value={repo}
                    onChange={(event) => {
                      setRepo(event.target.value);
                      setSelectedRepoId(ADD_NEW_REPO_OPTION);
                    }}
                    placeholder="product-app"
                    className="tw-w-full tw-rounded-xl tw-border tw-border-slate-700 tw-bg-slate-950 tw-px-3 tw-py-2 tw-text-sm tw-text-slate-100 tw-placeholder-slate-500 focus:tw-border-slate-500 focus:tw-outline-none"
                  />
                </label>
              </>
            )}
            <label className="tw-flex tw-flex-col tw-gap-2">
              <span className="tw-text-sm tw-font-medium tw-text-slate-200">Branch</span>
              <input
                value={branch}
                onChange={(event) => setBranch(event.target.value)}
                placeholder="main"
                className="tw-w-full tw-rounded-xl tw-border tw-border-slate-700 tw-bg-slate-950 tw-px-3 tw-py-2 tw-text-sm tw-text-slate-100 tw-placeholder-slate-500 focus:tw-border-slate-500 focus:tw-outline-none"
              />
            </label>
            <label className="tw-flex tw-flex-col tw-gap-2">
              <span className="tw-text-sm tw-font-medium tw-text-slate-200">Project</span>
              <select
                value={projectSelectValue}
                onChange={handleProjectSelect}
                className="tw-w-full tw-rounded-xl tw-border tw-border-slate-700 tw-bg-slate-950 tw-px-3 tw-py-2 tw-text-sm tw-text-slate-100 focus:tw-border-slate-500 focus:tw-outline-none"
              >
                <option value="">Use repo defaults</option>
                {projectOptions.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
                <option value={ADD_NEW_PROJECT_OPTION}>Add new project…</option>
              </select>
              {projectSlugsLoading ? (
                <span className="tw-text-xs tw-text-slate-400">Loading project slugs…</span>
              ) : null}
              {STANDALONE_MODE ? (
                <span className="tw-text-xs tw-text-slate-400">
                  Project discovery is unavailable in standalone mode.
                </span>
              ) : null}
              {projectSlugsError ? (
                <span className="tw-text-xs tw-text-rose-300">{projectSlugsError}</span>
              ) : null}
              {matchedRepoEntry && selectedProjectMeta?.source === "stored" ? (
                <div className="tw-flex tw-flex-wrap tw-items-center tw-gap-3 tw-pt-1">
                  <button
                    type="button"
                    onClick={handleRemoveProject}
                    disabled={isRemovingProject}
                    className="tw-text-[11px] tw-font-semibold tw-uppercase tw-tracking-wide tw-text-rose-300 hover:tw-text-rose-100"
                  >
                    {isRemovingProject ? "Removing…" : "Remove project"}
                  </button>
                  {removeProjectError ? (
                    <span className="tw-text-[11px] tw-text-rose-300">{removeProjectError}</span>
                  ) : null}
                </div>
              ) : null}
            </label>
            {projectSelectValue === ADD_NEW_PROJECT_OPTION && (
              <label className="tw-flex tw-flex-col tw-gap-2 md:tw-col-span-2">
                <span className="tw-text-sm tw-font-medium tw-text-slate-200">Project slug</span>
                <input
                  value={projectOverride}
                  onChange={(event) => {
                    setProjectOverride(event.target.value);
                    setProjectSelectValue(ADD_NEW_PROJECT_OPTION);
                  }}
                  placeholder="growth-experiments"
                  className="tw-w-full tw-rounded-xl tw-border tw-border-slate-700 tw-bg-slate-950 tw-px-3 tw-py-2 tw-text-sm tw-text-slate-100 tw-placeholder-slate-500 focus:tw-border-slate-500 focus:tw-outline-none"
                />
                <p className="tw-text-[11px] tw-text-slate-500">Roadmap file: {roadmapPath}</p>
              </label>
            )}
            <label className="tw-flex tw-flex-col tw-gap-2">
              <span className="tw-text-sm tw-font-medium tw-text-slate-200">Supabase probe URL (optional)</span>
              <input
                value={probeUrl}
                onChange={handleProbeChange}
                placeholder={resolvedSecrets.supabaseReadOnlyUrl ?? "https://.../rest/v1/rpc/roadmap_probe"}
                className="tw-w-full tw-rounded-xl tw-border tw-border-slate-700 tw-bg-slate-950 tw-px-3 tw-py-2 tw-text-sm tw-text-slate-100 tw-placeholder-slate-500 focus:tw-border-slate-500 focus:tw-outline-none"
              />
              {resolvedSecrets.supabaseReadOnlyUrl ? (
                <div className="tw-flex tw-items-center tw-justify-between tw-text-[11px] tw-text-slate-500">
                  <span>Default from {supabaseSourceLabel ?? "settings"}</span>
                  {probeCustomized ? (
                    <button
                      type="button"
                      onClick={resetProbeToDefault}
                      className="tw-text-[11px] tw-font-medium tw-text-slate-200 hover:tw-text-slate-100"
                    >
                      Use configured
                    </button>
                  ) : null}
                </div>
              ) : (
                <span className="tw-text-[11px] tw-text-slate-500">
                  Provide a checks endpoint or configure one in Settings.
                </span>
              )}
            </label>
          </div>
          <p className="tw-text-xs tw-text-slate-400">
            Roadmap file: <code className="tw-font-mono tw-text-[11px]">{roadmapPath}</code>
          </p>

          <div className="tw-flex tw-flex-wrap tw-items-center tw-justify-between tw-gap-4">
            <div className="tw-text-sm tw-text-slate-400">
              {statusGeneratedAt ? (
                <span>Last synced {statusGeneratedAt}</span>
              ) : (
                <span>Run discovery to generate the latest status and backlog files.</span>
              )}
            </div>
            <button
              type="submit"
              className="tw-inline-flex tw-items-center tw-gap-2 tw-rounded-full tw-bg-slate-100 tw-px-5 tw-py-2 tw-text-sm tw-font-semibold tw-text-slate-900 tw-transition tw-duration-200 tw-ease-out hover:tw-bg-slate-200 disabled:tw-cursor-not-allowed disabled:tw-bg-slate-700 disabled:tw-text-slate-400"
              disabled={!canSubmit}
            >
              {isSyncing ? "Syncing…" : "Connect and sync"}
            </button>
          </div>

          {error ? (
            <div className="tw-rounded-2xl tw-border tw-border-red-500/40 tw-bg-red-500/10 tw-p-4 tw-text-sm tw-text-red-100">
              <div className="tw-font-semibold">{error.title}</div>
              {error.detail ? <div className="tw-text-red-100/80">{error.detail}</div> : null}
            </div>
          ) : null}
        </section>

        <aside className="tw-space-y-4 tw-rounded-3xl tw-border tw-border-slate-800 tw-bg-slate-900 tw-p-8">
          <h2 className="tw-text-xl tw-font-semibold tw-text-slate-100">What this sync runs</h2>
          <ul className="tw-space-y-3 tw-text-sm tw-text-slate-300 tw-list-disc tw-pl-5">
            <li>
              <span className="tw-font-medium tw-text-slate-100">/api/run</span> regenerates <code className="tw-rounded tw-bg-slate-950 tw-px-1 tw-py-0.5">{statusPath}</code> and <code className="tw-rounded tw-bg-slate-950 tw-px-1 tw-py-0.5">{projectPlanPath}</code>.
            </li>
            <li>
              <span className="tw-font-medium tw-text-slate-100">/api/discover</span> looks for completed work outside the roadmap and updates <code className="tw-rounded tw-bg-slate-950 tw-px-1 tw-py-0.5">{backlogPath}</code>.
            </li>
            <li>Bring a Supabase probe URL to surface database checks along with code signals.</li>
          </ul>
          {dashboardHref ? (
            <Link
              href={dashboardHref}
              className="tw-inline-flex tw-items-center tw-gap-2 tw-rounded-full tw-border tw-border-slate-700 tw-bg-slate-900 tw-px-4 tw-py-2 tw-text-sm tw-font-semibold tw-text-slate-200 tw-transition tw-duration-200 tw-ease-out hover:tw-border-slate-600 hover:tw-text-slate-100"
            >
              <span>Open {repoSlug} dashboard</span>
              <span aria-hidden="true">↗</span>
            </Link>
          ) : null}
        </aside>
      </form>

      <section className="tw-grid tw-gap-6 xl:tw-grid-cols-2">
        <div
          id="discover"
          className="tw-space-y-4 tw-rounded-3xl tw-border tw-border-slate-800 tw-bg-slate-900 tw-p-8"
        >
          <div className="tw-flex tw-items-center tw-justify-between tw-gap-3">
            <div>
              <h2 className="tw-text-xl tw-font-semibold tw-text-slate-100">Roadmap status</h2>
              <p className="tw-text-sm tw-text-slate-300">Snapshot of {statusPath} after the latest run.</p>
            </div>
            {statusGeneratedAt ? (
              <span className="tw-rounded-full tw-border tw-border-slate-800 tw-bg-slate-950 tw-px-3 tw-py-1 tw-text-xs tw-font-medium tw-text-slate-400">
                {statusGeneratedAt}
              </span>
            ) : null}
          </div>
          {status?.weeks?.length ? (
            <StatusGrid status={status} />
          ) : (
            <div className="tw-rounded-2xl tw-border tw-border-slate-800 tw-bg-slate-950 tw-px-4 tw-py-8 tw-text-center tw-text-sm tw-text-slate-400">
              Run the sync to populate the roadmap status grid.
            </div>
          )}
        </div>

        <div className="tw-space-y-4 tw-rounded-3xl tw-border tw-border-slate-800 tw-bg-slate-900 tw-p-8">
          <div className="tw-flex tw-flex-wrap tw-items-center tw-justify-between tw-gap-3">
            <div>
              <h2 className="tw-text-xl tw-font-semibold tw-text-slate-100">Backlog discoveries</h2>
              <p className="tw-text-sm tw-text-slate-300">Preview of {backlogPath} entries to triage.</p>
            </div>
            <div className="tw-flex tw-flex-wrap tw-items-center tw-gap-2">
              {discoverArtifacts.length ? (
                <span className="tw-rounded-full tw-border tw-border-slate-800 tw-bg-slate-950 tw-px-3 tw-py-1 tw-text-xs tw-font-medium tw-text-slate-400">
                  {discoverArtifacts.length} files touched
                </span>
              ) : null}
              {discoveryGeneratedAt ? (
                <span className="tw-rounded-full tw-border tw-border-slate-800 tw-bg-slate-950 tw-px-3 tw-py-1 tw-text-xs tw-font-medium tw-text-slate-400">
                  Discovery {discoveryGeneratedAt}
                </span>
              ) : null}
              {!STANDALONE_MODE ? (
                <button
                  type="button"
                  onClick={handleDiscoverOnly}
                  className="tw-inline-flex tw-items-center tw-gap-2 tw-rounded-full tw-border tw-border-slate-700 tw-bg-slate-900 tw-px-4 tw-py-2 tw-text-xs tw-font-semibold tw-text-slate-200 tw-transition tw-duration-200 tw-ease-out hover:tw-border-slate-600 hover:tw-text-slate-100 disabled:tw-cursor-not-allowed disabled:tw-border-slate-800 disabled:tw-text-slate-500"
                  disabled={!canDiscover}
                >
                  {isDiscovering ? "Running…" : "Run discovery"}
                </button>
              ) : (
                <span className="tw-rounded-full tw-border tw-border-amber-500/40 tw-bg-amber-500/10 tw-px-3 tw-py-1 tw-text-xs tw-font-semibold tw-text-amber-100">
                  Discovery disabled in standalone mode
                </span>
              )}
            </div>
          </div>
          {backlog.length ? (
            <ul className="tw-space-y-3">
              {backlog.map((item) => (
                <li
                  key={item.id}
                  className="tw-flex tw-items-start tw-gap-3 tw-rounded-2xl tw-border tw-border-slate-800 tw-bg-slate-950 tw-p-4"
                >
                  <span className="tw-text-lg" aria-hidden="true">
                    {item.status === "complete" ? "✅" : "•"}
                  </span>
                  <div className="tw-space-y-1">
                    <p className="tw-text-sm tw-font-semibold tw-text-slate-100">{item.title}</p>
                    <p className="tw-text-xs tw-uppercase tw-tracking-wide tw-text-slate-400">{item.id}</p>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="tw-rounded-2xl tw-border tw-border-slate-800 tw-bg-slate-950 tw-px-4 tw-py-8 tw-text-center tw-text-sm tw-text-slate-400">
              {STANDALONE_MODE ? (
                <span>
                  Standalone mode does not auto-discover backlog items. Capture follow-ups manually after each status refresh.
                </span>
              ) : (
                <span>
                  Use <span className="tw-font-semibold tw-text-slate-200">Run discovery</span> to surface completed work that never landed on the roadmap.
                </span>
              )}
            </div>
          )}
          {seededDiscover ? (
            <div className="tw-rounded-2xl tw-border tw-border-emerald-500/40 tw-bg-emerald-500/10 tw-p-4 tw-text-xs tw-text-emerald-100">
              <div className="tw-font-semibold">Default discovery config created</div>
              <p className="tw-mt-1 tw-text-emerald-100/80">
                We added <code className="tw-rounded tw-bg-emerald-500/20 tw-px-1 tw-py-0.5">{discoverPath}</code> to your repo with starter queries and globs. Update that file in GitHub to refine discovery results.
              </p>
            </div>
          ) : null}
        </div>

        <div className="tw-space-y-4 tw-rounded-3xl tw-border tw-border-slate-800 tw-bg-slate-900 tw-p-8">
          <div className="tw-flex tw-flex-wrap tw-items-center tw-justify-between tw-gap-2">
            <h2 className="tw-text-xl tw-font-semibold tw-text-slate-100">Supabase probes</h2>
            {discoveryGeneratedAt ? (
              <span className="tw-rounded-full tw-border tw-border-slate-800 tw-bg-slate-950 tw-px-3 tw-py-1 tw-text-xs tw-font-medium tw-text-slate-400">
                Discovery {discoveryGeneratedAt}
              </span>
            ) : null}
          </div>
          <p className="tw-text-sm tw-text-slate-300">
            Results from <code className="tw-rounded tw-bg-slate-950 tw-px-1.5 tw-py-0.5">db_queries</code> in {discoverPath}.
          </p>
          {discoverConfig?.db_queries?.length ? (
            <p className="tw-text-xs tw-uppercase tw-tracking-wide tw-text-slate-400">
              {discoverConfig.db_queries.length} query{discoverConfig.db_queries.length === 1 ? "" : "ies"} configured
            </p>
          ) : null}
          {dbProbes.length ? (
            <ul className="tw-space-y-2">
              {dbProbes.map((probe) => (
                <li
                  key={probe.q}
                  className="tw-flex tw-items-start tw-gap-3 tw-rounded-2xl tw-border tw-border-slate-800 tw-bg-slate-950 tw-p-4"
                >
                  <span className="tw-text-lg" aria-hidden="true">
                    {probe.ok ? "✅" : "⚠️"}
                  </span>
                  <div className="tw-space-y-1">
                    <p className="tw-text-sm tw-font-semibold tw-text-slate-100">{probe.q}</p>
                    <p className="tw-text-xs tw-uppercase tw-tracking-wide tw-text-slate-400">
                      {probe.ok ? "Probe successful" : probe.why ? `Failed → ${probe.why}` : "Probe failed"}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="tw-rounded-2xl tw-border tw-border-slate-800 tw-bg-slate-950 tw-px-4 tw-py-8 tw-text-center tw-text-sm tw-text-slate-400">
              {STANDALONE_MODE
                ? "Standalone mode skips Supabase probes. Configure GitHub syncing to run database checks."
                : `Run discovery to execute Supabase probes defined in ${discoverPath}.`}
            </div>
          )}
          {discoverConfig?.notes?.length ? (
            <div className="tw-rounded-2xl tw-border tw-border-slate-800 tw-bg-slate-950 tw-p-4 tw-text-xs tw-text-slate-300">
              <div className="tw-font-semibold tw-text-slate-200">Notes</div>
              <ul className="tw-mt-2 tw-space-y-1 tw-list-disc tw-pl-4">
                {discoverConfig.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        <div className="tw-space-y-4 tw-rounded-3xl tw-border tw-border-slate-800 tw-bg-slate-900 tw-p-8">
          <div className="tw-flex tw-flex-wrap tw-items-center tw-justify-between tw-gap-2">
            <div>
              <h2 className="tw-text-xl tw-font-semibold tw-text-slate-100">Code path matches</h2>
              <p className="tw-text-sm tw-text-slate-300">
                Globs from {discoverPath} matched against the repository tree.
              </p>
            </div>
            {discoveryGeneratedAt ? (
              <span className="tw-rounded-full tw-border tw-border-slate-800 tw-bg-slate-950 tw-px-3 tw-py-1 tw-text-xs tw-font-medium tw-text-slate-400">
                Discovery {discoveryGeneratedAt}
              </span>
            ) : null}
          </div>
          {discoverConfig?.code_globs?.length ? (
            <p className="tw-text-xs tw-uppercase tw-tracking-wide tw-text-slate-400">
              {discoverConfig.code_globs.length} pattern{discoverConfig.code_globs.length === 1 ? "" : "s"} configured
            </p>
          ) : null}
          {codeMatches.length ? (
            <ul className="tw-space-y-2">
              {codeMatches.map((path) => (
                <li
                  key={path}
                  className="tw-rounded-2xl tw-border tw-border-slate-800 tw-bg-slate-950 tw-px-4 tw-py-2 tw-text-sm tw-text-slate-200"
                >
                  {path}
                </li>
              ))}
            </ul>
          ) : (
            <div className="tw-rounded-2xl tw-border tw-border-slate-800 tw-bg-slate-950 tw-px-4 tw-py-8 tw-text-center tw-text-sm tw-text-slate-400">
              {STANDALONE_MODE
                ? "Standalone mode cannot scan repository trees. Enable GitHub syncing to view matched code paths."
                : "Run discovery to surface matched code paths from your repository."}
            </div>
          )}
        </div>

        <div className="tw-space-y-4 tw-rounded-3xl tw-border tw-border-slate-800 tw-bg-slate-900 tw-p-8 xl:tw-col-span-2">
          <h2 className="tw-text-xl tw-font-semibold tw-text-slate-100">Artifacts updated</h2>
          <div className="tw-grid tw-gap-4 md:tw-grid-cols-2">
            <div className="tw-space-y-2">
              <h3 className="tw-text-sm tw-font-semibold tw-text-slate-200">Status run</h3>
              {runArtifacts.length ? (
                <ul className="tw-space-y-1 tw-text-sm tw-text-slate-300">
                  {runArtifacts.map((path) => (
                    <li key={path} className="tw-rounded-xl tw-border tw-border-slate-800 tw-bg-slate-950 tw-px-3 tw-py-2">
                      {path}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="tw-text-sm tw-text-slate-400">Run the sync to regenerate roadmap artifacts.</p>
              )}
            </div>
            <div className="tw-space-y-2">
              <h3 className="tw-text-sm tw-font-semibold tw-text-slate-200">Discover run</h3>
              {discoverArtifacts.length ? (
                <ul className="tw-space-y-1 tw-text-sm tw-text-slate-300">
                  {discoverArtifacts.map((path) => (
                    <li key={path} className="tw-rounded-xl tw-border tw-border-slate-800 tw-bg-slate-950 tw-px-3 tw-py-2">
                      {path}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="tw-text-sm tw-text-slate-400">
                  {STANDALONE_MODE
                    ? "Discovery artifacts are unavailable in standalone mode."
                    : "Run discovery to surface backlog entries and summary docs."}
                </p>
              )}
            </div>
          </div>
        </div>

        <div
          id="context-pack"
          className="tw-space-y-4 tw-rounded-3xl tw-border tw-border-slate-800 tw-bg-slate-900 tw-p-8 xl:tw-col-span-2"
        >
          <div className="tw-flex tw-flex-col tw-gap-4 md:tw-flex-row md:tw-items-center md:tw-justify-between">
            <div className="tw-space-y-1">
              <h2 className="tw-text-xl tw-font-semibold tw-text-slate-100">Context pack export</h2>
              <p className="tw-text-sm tw-text-slate-300">
                Bundle {roadmapPath}, {statusPath}, {backlogPath}, {summaryPath}, the stack references, <code className="tw-font-mono tw-text-[11px]">dashboard/README.md</code>, Supabase setup guides, and the latest status/manual snapshots into a single JSON payload for AI copilots.
              </p>
            </div>
            <button
              type="button"
              onClick={handleExportContext}
              className="tw-inline-flex tw-items-center tw-gap-2 tw-rounded-full tw-bg-slate-100 tw-px-5 tw-py-2 tw-text-sm tw-font-semibold tw-text-slate-900 tw-transition tw-duration-200 tw-ease-out hover:tw-bg-slate-200 disabled:tw-cursor-not-allowed disabled:tw-bg-slate-700 disabled:tw-text-slate-400"
              disabled={!repoSlug || isExporting}
            >
              {isExporting ? "Building dashboard hand-off…" : "Export dashboard hand-off"}
            </button>
          </div>
          {contextWarning ? (
            <div className="tw-rounded-2xl tw-border tw-border-amber-500/40 tw-bg-amber-500/10 tw-p-4 tw-text-sm tw-text-amber-100">
              <div className="tw-font-semibold">Heads up</div>
              <p className="tw-text-amber-100/80">{contextWarning}</p>
            </div>
          ) : null}
          {contextError ? (
            <div className="tw-rounded-2xl tw-border tw-border-red-500/40 tw-bg-red-500/10 tw-p-4 tw-text-sm tw-text-red-100">
              <div className="tw-font-semibold">{contextError.title}</div>
              {contextError.detail ? <div className="tw-text-red-100/80">{contextError.detail}</div> : null}
            </div>
          ) : null}
          {contextPack ? (
            <div className="tw-space-y-4">
              <div className="tw-flex tw-flex-wrap tw-items-center tw-gap-3">
                {contextGeneratedAt ? (
                  <span className="tw-rounded-full tw-border tw-border-slate-800 tw-bg-slate-950 tw-px-3 tw-py-1 tw-text-xs tw-font-medium tw-text-slate-400">
                    Generated {contextGeneratedAt}
                  </span>
                ) : null}
                {contextPack.repo?.project ? (
                  <span className="tw-rounded-full tw-border tw-border-slate-800 tw-bg-slate-950 tw-px-3 tw-py-1 tw-text-xs tw-font-medium tw-text-slate-400">
                    Project {contextPack.repo.project}
                  </span>
                ) : null}
                {contextPack.repo?.branch ? (
                  <span className="tw-rounded-full tw-border tw-border-slate-800 tw-bg-slate-950 tw-px-3 tw-py-1 tw-text-xs tw-font-medium tw-text-slate-400">
                    Branch {contextPack.repo.branch}
                  </span>
                ) : null}
                {contextPack.source ? (
                  <span className="tw-rounded-full tw-border tw-border-slate-800 tw-bg-slate-950 tw-px-3 tw-py-1 tw-text-xs tw-font-medium tw-text-slate-400">
                    Source {contextPack.source}
                  </span>
                ) : null}
                <button
                  type="button"
                  onClick={handleDownloadContext}
                  className="tw-inline-flex tw-items-center tw-gap-2 tw-rounded-full tw-border tw-border-slate-700 tw-bg-slate-900 tw-px-4 tw-py-2 tw-text-sm tw-font-semibold tw-text-slate-200 tw-transition tw-duration-200 tw-ease-out hover:tw-border-slate-600 hover:tw-text-slate-100"
                >
                  Download JSON
                </button>
              </div>
              {contextFiles.length ? (
                <div className="tw-space-y-2">
                  <h3 className="tw-text-sm tw-font-semibold tw-text-slate-200">Included files</h3>
                  <ul className="tw-grid tw-gap-2 md:tw-grid-cols-2">
                    {contextFiles.map((file) => (
                      <li
                        key={file}
                        className="tw-rounded-xl tw-border tw-border-slate-800 tw-bg-slate-950 tw-px-3 tw-py-2 tw-text-sm tw-text-slate-300"
                      >
                        {file}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {contextJson ? (
                <details className="tw-rounded-2xl tw-border tw-border-slate-800 tw-bg-slate-950 tw-px-4 tw-py-3">
                  <summary className="tw-cursor-pointer tw-text-sm tw-font-semibold tw-text-slate-200">
                    View JSON payload
                  </summary>
                  <pre className="tw-mt-3 tw-max-h-96 tw-overflow-auto tw-rounded-xl tw-bg-slate-950 tw-p-4 tw-text-xs tw-leading-relaxed tw-text-slate-300">
                    {contextJson}
                  </pre>
                </details>
              ) : null}
            </div>
          ) : (
            <p className="tw-text-sm tw-text-slate-400">
              {STANDALONE_MODE
                ? "Standalone mode generates this export from the in-memory workspace so you can share demo data without GitHub, including dashboard docs and the latest manual/status snapshots."
                : "Export the dashboard hand-off bundle so AI teammates receive roadmap files, dashboard references, and the freshest manual/status snapshots."}
            </p>
          )}
        </div>
      </section>
      </>
    </div>
  );
}

export default function MidProjectSyncWorkspace() {
  return (
    <Suspense fallback={<div className="tw-px-6 tw-py-10 tw-text-sm tw-text-slate-400">Loading mid-project workspace…</div>}>
      <MidProjectSyncWorkspaceInner />
    </Suspense>
  );
}
