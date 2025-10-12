"use client";

import {
  ChangeEvent,
  FormEvent,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { load } from "js-yaml";

import { describeProjectFile, normalizeProjectKey } from "@/lib/project-paths";
import { mergeProjectOptions } from "@/lib/project-options";
import { ROADMAP_HANDOFF_KEY } from "@/lib/wizard-handoff";
import { useLocalSecrets, useResolvedSecrets } from "@/lib/use-local-secrets";

type ErrorState = { title: string; detail?: string } | null;
type SuccessState = {
  created: string[];
  skipped: string[];
  owner: string;
  repo: string;
  branch?: string;
  prUrl?: string;
  pullRequestNumber?: number;
  path?: string;
  project?: string;
} | null;

type UploadState = {
  name: string;
  sizeLabel: string;
};

type HandoffHint = {
  path: string;
  label?: string;
  content?: string;
  owner?: string;
  repo?: string;
  branch?: string;
  promotedBranch?: string;
  project?: string | null;
  prUrl?: string;
  pullRequestNumber?: number;
};

const ADD_NEW_REPO_OPTION = "__add_new_repo__";
const ADD_NEW_PROJECT_OPTION = "__add_new_project__";

type ImportResponse = {
  ok: boolean;
  created?: string[];
  skipped?: string[];
  branch?: string;
  prUrl?: string;
  pullRequestNumber?: number;
  error?: string;
  detail?: string;
};

type RunResponse = {
  ok?: boolean;
  wrote?: string[];
  error?: string;
  detail?: string;
};

function formatBytes(bytes: number) {
  if (Number.isNaN(bytes) || bytes <= 0) {
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

function RoadmapProvisionerInner() {
  const params = useSearchParams();
  const handoffParam = params.get("handoff");
  const [owner, setOwner] = useState(() => params.get("owner") ?? "");
  const [repo, setRepo] = useState(() => params.get("repo") ?? "");
  const [branch, setBranch] = useState(() => params.get("branch") ?? "main");
  const [project, setProject] = useState(() => params.get("project") ?? "");
  const [upload, setUpload] = useState<UploadState | null>(null);
  const [roadmap, setRoadmap] = useState("");
  const [error, setError] = useState<ErrorState>(null);
  const [success, setSuccess] = useState<SuccessState>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [uploadKey, setUploadKey] = useState(0);
  const [handoffHint, setHandoffHint] = useState<HandoffHint | null>(null);
  const [handoffNotice, setHandoffNotice] = useState<string | null>(null);
  const [handoffError, setHandoffError] = useState<string | null>(null);
  const [isImportingHandoff, setIsImportingHandoff] = useState(false);
  const [initialContextApplied, setInitialContextApplied] = useState(false);
  const [hasImportedHandoff, setHasImportedHandoff] = useState(false);
  const secretsStore = useLocalSecrets();
  const secrets = useResolvedSecrets(owner, repo, project || undefined);
  const githubConfigured = Boolean(secrets.githubPat);
  const [openAsPr, setOpenAsPr] = useState(false);
  const [isRunningRun, setIsRunningRun] = useState(false);
  const [runArtifacts, setRunArtifacts] = useState<string[]>([]);
  const [runNotice, setRunNotice] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") {
      if (handoffParam) {
        setHandoffHint({ path: handoffParam });
      }
      return;
    }

    try {
      const storedRaw = window.localStorage.getItem(ROADMAP_HANDOFF_KEY);
      const stored = storedRaw ? (JSON.parse(storedRaw) as HandoffHint & { createdAt?: number }) : null;

      const applyContext = (hint: HandoffHint | null) => {
        if (!hint || initialContextApplied) {
          return;
        }
        let updated = false;
        if (hint.owner && !owner) {
          setOwner(hint.owner);
          updated = true;
        }
        if (hint.repo && !repo) {
          setRepo(hint.repo);
          updated = true;
        }
        const promoted = hint.promotedBranch?.trim();
        if (promoted && (!branch || branch === "main")) {
          setBranch(promoted);
          updated = true;
        } else if (hint.branch && (!branch || branch === "main")) {
          setBranch(hint.branch);
          updated = true;
        }
        if (hint.project && !project) {
          setProject(hint.project);
          updated = true;
        }
        if (updated || hint.owner || hint.repo || hint.branch || hint.project) {
          setInitialContextApplied(true);
        }
      };

      const hydrateHint = (hint: HandoffHint | null) => {
        if (!hint) {
          return null;
        }
        return {
          path: hint.path,
          label: hint.label,
          content: hint.content,
          owner: hint.owner,
          repo: hint.repo,
          branch: hint.branch,
          promotedBranch: hint.promotedBranch,
          project: hint.project ?? null,
          prUrl: hint.prUrl,
          pullRequestNumber: hint.pullRequestNumber,
        } satisfies HandoffHint;
      };

      if (handoffParam) {
        if (stored && stored.path === handoffParam) {
          const hydrated = hydrateHint(stored);
          setHandoffHint(hydrated);
          setHasImportedHandoff(Boolean(hydrated?.content));
          applyContext(hydrated);
        } else {
          setHandoffHint({ path: handoffParam });
          setHasImportedHandoff(false);
        }
      } else if (stored?.path) {
        const hydrated = hydrateHint(stored);
        setHandoffHint(hydrated);
        setHasImportedHandoff(Boolean(hydrated?.content));
        applyContext(hydrated);
      } else {
        setHandoffHint(null);
        setHasImportedHandoff(false);
      }
    } catch (err) {
      console.error("Failed to read roadmap handoff", err);
      if (handoffParam) {
        setHandoffHint({ path: handoffParam });
        setHasImportedHandoff(false);
      }
    }
  }, [handoffParam, branch, owner, project, repo, initialContextApplied]);

  const repoEntries = secretsStore.repos;
  const [selectedRepoId, setSelectedRepoId] = useState<string>(ADD_NEW_REPO_OPTION);
  const [selectedProjectOption, setSelectedProjectOption] = useState<string>("");
  const [discoveredProjectSlugs, setDiscoveredProjectSlugs] = useState<string[]>([]);
  const [projectSlugsLoading, setProjectSlugsLoading] = useState(false);
  const [projectSlugsError, setProjectSlugsError] = useState<string | null>(null);
  const repoSlug = useMemo(() => {
    const ownerSlug = owner.trim().toLowerCase();
    const repoSlugValue = repo.trim().toLowerCase();
    return ownerSlug && repoSlugValue ? `${ownerSlug}/${repoSlugValue}` : "";
  }, [owner, repo]);
  const matchedRepoEntry = useMemo(() => {
    if (!repoSlug) return undefined;
    return repoEntries.find(
      (entry) => `${entry.owner.toLowerCase()}/${entry.repo.toLowerCase()}` === repoSlug,
    );
  }, [repoEntries, repoSlug]);

  const roadmapPreview = useMemo(() => roadmap.trim(), [roadmap]);
  const hasRoadmap = Boolean(roadmapPreview);
  const projectKey = useMemo(() => normalizeProjectKey(project), [project]);
  const successProjectKey = useMemo(() => normalizeProjectKey(success?.project), [success?.project]);
  const effectiveProjectKey = successProjectKey ?? projectKey;
  const roadmapPath = describeProjectFile("docs/roadmap.yml", effectiveProjectKey);
  const infraPath = describeProjectFile("docs/infra-facts.md", effectiveProjectKey);
  const stackPath = describeProjectFile("docs/tech-stack.yml", effectiveProjectKey);
  const workflowPath = describeProjectFile(".github/workflows/roadmap.yml", effectiveProjectKey);
  const statusPath = describeProjectFile("docs/roadmap-status.json", effectiveProjectKey);
  const planPath = describeProjectFile("docs/project-plan.md", effectiveProjectKey);
  const projectOptions = useMemo(
    () => mergeProjectOptions(matchedRepoEntry?.projects, discoveredProjectSlugs),
    [matchedRepoEntry?.projects, discoveredProjectSlugs],
  );
  const canSubmit = Boolean(!isSubmitting && owner && repo && branch && hasRoadmap);
  const normalizedRunArtifacts = useMemo(
    () => runArtifacts.map((artifact) => artifact.replace(/\s*\(FAILED:.*\)$/i, "")),
    [runArtifacts],
  );
  const distinctRunArtifacts = useMemo(() => {
    const seen = new Set<string>();
    const distinct: string[] = [];
    for (const artifact of normalizedRunArtifacts) {
      const key = artifact.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      distinct.push(artifact);
    }
    return distinct;
  }, [normalizedRunArtifacts]);
  const hasStatusArtifact = useMemo(() => distinctRunArtifacts.includes(statusPath), [distinctRunArtifacts, statusPath]);
  const hasPlanArtifact = useMemo(() => distinctRunArtifacts.includes(planPath), [distinctRunArtifacts, planPath]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (!handoffHint || !hasImportedHandoff) {
      return;
    }

    const nextOwner = owner.trim();
    const nextRepo = repo.trim();
    const nextBranch = branch.trim();
    const nextProject = project.trim();
    const normalizedProject = nextProject ? nextProject : null;
    const currentProject = handoffHint.project ?? null;

    const hasChanges =
      (handoffHint.owner ?? "").trim() !== nextOwner ||
      (handoffHint.repo ?? "").trim() !== nextRepo ||
      (handoffHint.branch ?? "").trim() !== nextBranch ||
      currentProject !== normalizedProject;

    if (!hasChanges) {
      return;
    }

    const mergedHint: HandoffHint = {
      ...handoffHint,
      owner: nextOwner || undefined,
      repo: nextRepo || undefined,
      branch: nextBranch || undefined,
      project: normalizedProject,
    };

    setHandoffHint(mergedHint);
    const storedPayload = { ...mergedHint, createdAt: Date.now() };
    window.localStorage.setItem(ROADMAP_HANDOFF_KEY, JSON.stringify(storedPayload));
  }, [branch, hasImportedHandoff, handoffHint, owner, project, repo]);

  useEffect(() => {
    const nextRepoId = matchedRepoEntry?.id ?? ADD_NEW_REPO_OPTION;
    setSelectedRepoId((current) => (current === nextRepoId ? current : nextRepoId));
  }, [matchedRepoEntry?.id]);

  useEffect(() => {
    const trimmedOwner = owner.trim();
    const trimmedRepo = repo.trim();
    const trimmedBranch = branch.trim() || "main";
    if (!trimmedOwner || !trimmedRepo) {
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
    if (secrets.githubPat && secrets.sources.githubPat) {
      headers["x-github-pat"] = secrets.githubPat;
    }

    fetch(
      `/api/projects/${encodeURIComponent(trimmedOwner)}/${encodeURIComponent(trimmedRepo)}?branch=${encodeURIComponent(trimmedBranch)}`,
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
  }, [owner, repo, branch, secrets.githubPat, secrets.sources.githubPat]);

  useEffect(() => {
    if (owner || repo) {
      return;
    }
    const [firstRepo] = repoEntries;
    if (!firstRepo) {
      return;
    }
    setOwner(firstRepo.owner);
    setRepo(firstRepo.repo);
    setSelectedRepoId(firstRepo.id);
    if (!project && firstRepo.projects.length === 1) {
      setProject(firstRepo.projects[0].id);
    }
  }, [owner, repo, project, repoEntries]);

  useEffect(() => {
    if (!project) {
      setSelectedProjectOption((current) => (current === "" ? current : ""));
      return;
    }
    const matchingProject = projectOptions.find((option) => option.id === project);
    const nextProjectOption = matchingProject ? matchingProject.id : ADD_NEW_PROJECT_OPTION;
    setSelectedProjectOption((current) => (current === nextProjectOption ? current : nextProjectOption));
  }, [project, projectOptions]);

  const handleRepoSelect = (event: ChangeEvent<HTMLSelectElement>) => {
    const value = event.target.value;
    setSelectedRepoId(value);
    if (value === ADD_NEW_REPO_OPTION) {
      return;
    }
    const entry = repoEntries.find((repoEntry) => repoEntry.id === value);
    if (entry) {
      setOwner(entry.owner);
      setRepo(entry.repo);
      if (entry.projects.length === 1) {
        setProject(entry.projects[0].id);
      }
    }
  };

  const handleProjectSelect = (event: ChangeEvent<HTMLSelectElement>) => {
    const value = event.target.value;
    setSelectedProjectOption(value);
    if (!value) {
      setProject("");
      return;
    }
    if (value === ADD_NEW_PROJECT_OPTION) {
      if (projectOptions.some((option) => option.id === project)) {
        setProject("");
      }
      return;
    }
    const match = projectOptions.find((option) => option.id === value);
    if (match) {
      setProject(match.id);
    }
  };

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    setHandoffNotice(null);
    setHandoffError(null);
    const file = event.target.files?.[0];
    if (!file) {
      setUpload(null);
      setRoadmap("");
      setSuccess(null);
      setUploadKey((value) => value + 1);
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      setError({ title: "File too large", detail: "Limit uploads to 2MB roadmap files." });
      event.target.value = "";
      setUpload(null);
      setRoadmap("");
      setUploadKey((value) => value + 1);
      return;
    }

    try {
      const text = await file.text();
      if (!text.trim()) {
        throw new Error("Roadmap file is empty");
      }
      load(text);
      setRoadmap(text.trimEnd());
      setUpload({ name: file.name, sizeLabel: formatBytes(file.size) });
      setError(null);
      setSuccess(null);
    } catch (err: any) {
      setError({ title: "Invalid roadmap.yml", detail: err?.message ?? String(err) });
      setUpload(null);
      setRoadmap("");
      setUploadKey((value) => value + 1);
    }
  }

  async function importHandoff() {
    if (!handoffHint) {
      return;
    }

    setIsImportingHandoff(true);
    setHandoffNotice(null);
    setHandoffError(null);

    try {
      let content = handoffHint.content ?? "";
      let name = handoffHint.label ?? handoffHint.path;
      let sizeLabel = "";

      if (!content) {
        const fetchOwner = (handoffHint.owner || owner || "").trim();
        const fetchRepo = (handoffHint.repo || repo || "").trim();
        if (!fetchOwner || !fetchRepo) {
          setHandoffError("Provide owner and repo before importing the shared roadmap.");
          return;
        }

        const params = new URLSearchParams({ path: handoffHint.path });
        params.set("owner", fetchOwner);
        params.set("repo", fetchRepo);
        const fetchBranchSource = handoffHint.promotedBranch || handoffHint.branch || branch || "main";
        const fetchBranch = fetchBranchSource.trim();
        if (fetchBranch) {
          params.set("branch", fetchBranch);
        }
        const fetchProject = handoffHint.project ?? (project || "");
        if (fetchProject) {
          params.set("project", fetchProject);
        }

        const headers: HeadersInit = {};
        if (secrets.githubPat) {
          headers["x-github-pat"] = secrets.githubPat;
        }

        const response = await fetch(`/api/wizard/handoff?${params.toString()}`, { headers });
        const payload = await response.json().catch(() => ({}));

        if (!response.ok || !payload?.ok) {
          const title = typeof payload?.error === "string" ? payload.error : "Failed to import shared roadmap";
          setHandoffError(title);
          return;
        }

        content = typeof payload.content === "string" ? payload.content : "";
        const payloadLabel = typeof payload.label === "string" ? payload.label : undefined;
        name = payloadLabel ?? (typeof payload.name === "string" ? payload.name : name);
        sizeLabel = typeof payload.sizeLabel === "string" ? payload.sizeLabel : sizeLabel;
        const normalizedPath = typeof payload.path === "string" ? payload.path : handoffHint.path;
        const baseBranchValue = handoffHint.branch || branch || "main";
        const baseBranch = typeof baseBranchValue === "string" ? baseBranchValue.trim() : "";
        const projectForHint = (handoffHint.project ?? fetchProject) || null;
        const updatedHint: HandoffHint = {
          ...handoffHint,
          path: normalizedPath,
          label: payloadLabel ?? name,
          content,
          owner: fetchOwner || undefined,
          repo: fetchRepo || undefined,
          branch: baseBranch?.trim() || undefined,
          promotedBranch: fetchBranch,
          project: projectForHint,
        };
        setHandoffHint(updatedHint);
        setHasImportedHandoff(Boolean(updatedHint.content));
        if (typeof window !== "undefined") {
          const storedPayload = { ...updatedHint, createdAt: Date.now() };
          window.localStorage.setItem(ROADMAP_HANDOFF_KEY, JSON.stringify(storedPayload));
        }
      } else {
        sizeLabel = formatBytes(new TextEncoder().encode(content).length);
      }

      const trimmed = content.trim();
      if (!trimmed) {
        setHandoffError("Shared roadmap is empty");
        return;
      }

      try {
        load(trimmed);
      } catch (err) {
        setHandoffError(err instanceof Error ? err.message : String(err));
        return;
      }

      const effectiveSizeLabel = sizeLabel || formatBytes(new TextEncoder().encode(trimmed).length);
      setRoadmap(trimmed);
      setUpload({ name, sizeLabel: effectiveSizeLabel });
      setUploadKey((value) => value + 1);
      setSuccess(null);
      setHandoffNotice(`Imported ${name} from concept workspace.`);
      setHasImportedHandoff(true);
    } catch (err) {
      setHandoffError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsImportingHandoff(false);
    }
  }

  const runRoadmapStatus = useCallback(
    async ({ owner: runOwner, repo: runRepo, branch: runBranch, project: runProject }: {
      owner: string;
      repo: string;
      branch: string;
      project?: string;
    }) => {
      setIsRunningRun(true);
      setRunError(null);
      setRunNotice(null);
      setRunArtifacts([]);
      try {
        const headers: HeadersInit = { "Content-Type": "application/json" };
        if (secrets.githubPat) {
          headers["x-github-pat"] = secrets.githubPat;
        }
        const body: Record<string, string> = {
          owner: runOwner,
          repo: runRepo,
          branch: runBranch,
        };
        if (runProject) {
          body.project = runProject;
        }
        const response = await fetch("/api/run", {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        });
        const payload = (await response.json().catch(() => ({}))) as RunResponse;
        if (!response.ok || payload?.ok === false || payload?.error) {
          const detail = typeof payload?.detail === "string" && payload.detail.trim() ? payload.detail : null;
          setRunError(detail ? `${payload?.error ?? "Failed to refresh status"}: ${detail}` : payload?.error ?? "Failed to refresh status");
          setRunArtifacts(payload?.wrote ?? []);
          return;
        }
        setRunArtifacts(payload?.wrote ?? []);
        setRunNotice("Dashboard prerequisites committed.");
      } catch (err: any) {
        setRunError(err instanceof Error ? err.message : String(err));
      } finally {
        setIsRunningRun(false);
      }
    },
    [secrets.githubPat],
  );

  const handleRunRetry = useCallback(() => {
    if (!success) {
      return;
    }
    const retryBranch = success.branch?.trim() || branch.trim() || "main";
    const retryProject = success.project?.trim() || undefined;
    void runRoadmapStatus({
      owner: success.owner.trim(),
      repo: success.repo.trim(),
      branch: retryBranch,
      project: retryProject,
    });
  }, [branch, runRoadmapStatus, success]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) {
      setError({ title: "Provide required fields", detail: "Upload a roadmap and fill owner/repo before continuing." });
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setSuccess(null);
    setRunArtifacts([]);
    setRunNotice(null);
    setRunError(null);

    try {
      const trimmedOwner = owner.trim();
      const trimmedRepo = repo.trim();
      const trimmedBranch = branch.trim() || "main";
      const trimmedProject = project.trim();
      const projectPayload = trimmedProject ? trimmedProject : undefined;

      const headers: HeadersInit = { "Content-Type": "application/json" };
      if (secrets.githubPat) {
        headers["x-github-pat"] = secrets.githubPat;
      }

      const endpoint = openAsPr ? "/api/roadmap/import?asPR=true" : "/api/roadmap/import";
      const response = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({
          owner: trimmedOwner,
          repo: trimmedRepo,
          branch: trimmedBranch,
          roadmap,
          project: projectPayload,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as ImportResponse;
      if (!response.ok || !payload?.ok) {
        const title = payload?.error ?? "Failed to import roadmap";
        setError({ title, detail: payload?.detail });
        return;
      }

      const followupBranch = payload.branch?.trim() || trimmedBranch;

      setSuccess({
        created: payload.created ?? [],
        skipped: payload.skipped ?? [],
        owner: trimmedOwner,
        repo: trimmedRepo,
        branch: followupBranch,
        prUrl: payload.prUrl,
        pullRequestNumber: payload.pullRequestNumber,
        project: projectPayload,
      });

      void runRoadmapStatus({
        owner: trimmedOwner,
        repo: trimmedRepo,
        branch: followupBranch,
        project: projectPayload,
      });
    } catch (err: any) {
      setError({ title: "Request failed", detail: err instanceof Error ? err.message : String(err) });
    } finally {
      setIsSubmitting(false);
    }
  }

  const projectQueryKey = effectiveProjectKey ?? undefined;
  const projectQuery = projectQueryKey ? `&project=${encodeURIComponent(projectQueryKey)}` : "";
  const dashboardHref = success && success.owner && success.repo
    ? `/dashboard?owner=${encodeURIComponent(success.owner.trim())}&repo=${encodeURIComponent(success.repo.trim())}${projectQuery}`
    : null;

  return (
    <div className="tw-space-y-10">
      <header className="tw-space-y-3">
        <span className="tw-inline-flex tw-items-center tw-gap-2 tw-rounded-full tw-border tw-border-slate-800 tw-px-3 tw-py-1 tw-text-xs tw-font-medium tw-uppercase tw-tracking-wide tw-text-slate-300">
          Roadmap provisioning
        </span>
        <h1 className="tw-text-3xl tw-font-bold tw-leading-tight tw-text-slate-100">
          Import roadmap.yml and scaffold automations
        </h1>
        <p className="tw-text-base tw-leading-relaxed tw-text-slate-300">
          Upload your finalized roadmap to sync docs/roadmap.yml, then generate the foundational artifacts that power status checks and team context.
        </p>
        <p className="tw-text-xs tw-font-medium tw-uppercase tw-tracking-wide tw-text-slate-400">
          {githubConfigured ? "GitHub token ready" : "Add a GitHub PAT in Settings to allow commits"}
        </p>
      </header>

      <form onSubmit={handleSubmit} className="tw-grid tw-gap-8 lg:tw-grid-cols-[2fr,1fr]">
        <section className="tw-space-y-6 tw-rounded-3xl tw-border tw-border-slate-800 tw-bg-slate-900 tw-p-8">
          <div className="tw-grid tw-gap-4 md:tw-grid-cols-2">
            <label className="tw-flex tw-flex-col tw-gap-2">
              <span className="tw-text-sm tw-font-medium tw-text-slate-200">Linked repository</span>
              <select
                value={selectedRepoId}
                onChange={handleRepoSelect}
                className="tw-w-full tw-rounded-xl tw-border tw-border-slate-700 tw-bg-slate-950 tw-px-3 tw-py-2 tw-text-sm tw-text-slate-100 focus:tw-border-slate-500 focus:tw-outline-none"
              >
                <option value={ADD_NEW_REPO_OPTION}>Add new repo…</option>
                {repoEntries.map((entry) => {
                  const label = entry.displayName?.trim() || `${entry.owner}/${entry.repo}`;
                  return (
                    <option key={entry.id} value={entry.id}>
                      {label}
                    </option>
                  );
                })}
              </select>
            </label>
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
              <span className="tw-text-sm tw-font-medium tw-text-slate-200">Project (optional)</span>
              <select
                value={selectedProjectOption}
                onChange={handleProjectSelect}
                className="tw-w-full tw-rounded-xl tw-border tw-border-slate-700 tw-bg-slate-950 tw-px-3 tw-py-2 tw-text-sm tw-text-slate-100 focus:tw-border-slate-500 focus:tw-outline-none"
              >
                <option value="">Use repo defaults</option>
                {projectOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
                <option value={ADD_NEW_PROJECT_OPTION}>Add new project…</option>
              </select>
              {projectSlugsLoading ? (
                <span className="tw-text-xs tw-text-slate-400">Loading project slugs…</span>
              ) : null}
              {projectSlugsError ? (
                <span className="tw-text-xs tw-text-rose-300">{projectSlugsError}</span>
              ) : null}
            </label>
            {selectedRepoId === ADD_NEW_REPO_OPTION && (
              <div className="tw-grid tw-gap-4 md:tw-col-span-2 md:tw-grid-cols-2">
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
              </div>
            )}
            {selectedProjectOption === ADD_NEW_PROJECT_OPTION && (
              <label className="tw-flex tw-flex-col tw-gap-2 md:tw-col-span-2">
                <span className="tw-text-sm tw-font-medium tw-text-slate-200">Project slug</span>
                <input
                  value={project}
                  onChange={(event) => {
                    setProject(event.target.value);
                    setSelectedProjectOption(ADD_NEW_PROJECT_OPTION);
                  }}
                  placeholder="growth-experiments"
                  className="tw-w-full tw-rounded-xl tw-border tw-border-slate-700 tw-bg-slate-950 tw-px-3 tw-py-2 tw-text-sm tw-text-slate-100 tw-placeholder-slate-500 focus:tw-border-slate-500 focus:tw-outline-none"
                />
              </label>
            )}
          </div>
          <p className="tw-text-xs tw-text-slate-400">
            Target files include <code className="tw-font-mono tw-text-[11px]">{roadmapPath}</code>, <code className="tw-font-mono tw-text-[11px]">{infraPath}</code>, and <code className="tw-font-mono tw-text-[11px]">{stackPath}</code>.
          </p>

          {handoffHint && (
            <div className="tw-space-y-2 tw-rounded-2xl tw-border tw-border-emerald-500/40 tw-bg-emerald-500/10 tw-p-4">
              <div className="tw-flex tw-flex-wrap tw-items-center tw-justify-between tw-gap-3">
                <div className="tw-space-y-1">
                  <p className="tw-text-sm tw-font-semibold tw-text-emerald-100">
                    Pull {handoffHint.label ?? handoffHint.path} from Concept
                  </p>
                  <p className="tw-text-xs tw-text-emerald-100/80">
                    Start provisioning with the roadmap you just generated without downloading it again.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={importHandoff}
                  disabled={isImportingHandoff}
                  className="tw-inline-flex tw-items-center tw-gap-2 tw-rounded-full tw-border tw-border-emerald-400 tw-bg-emerald-500/20 tw-px-3 tw-py-1.5 tw-text-xs tw-font-semibold tw-uppercase tw-tracking-wide tw-text-emerald-100 hover:tw-border-emerald-300 hover:tw-text-white disabled:tw-opacity-60"
                >
                  {isImportingHandoff ? "Importing…" : "Import roadmap"}
                </button>
              </div>
              {handoffNotice && <p className="tw-text-xs tw-text-emerald-100/80">{handoffNotice}</p>}
              {handoffError && <p className="tw-text-xs tw-text-red-200">{handoffError}</p>}
            </div>
          )}

          <div className="tw-space-y-3">
            <label htmlFor="roadmap-upload" className="tw-block tw-text-sm tw-font-medium tw-text-slate-200">
              Upload {roadmapPath}
            </label>
            <input
              key={uploadKey}
              id="roadmap-upload"
              type="file"
              accept=".yml,.yaml"
              onChange={handleFileChange}
              className="tw-w-full tw-rounded-xl tw-border tw-border-dashed tw-border-slate-700 tw-bg-slate-950 tw-px-3 tw-py-3 tw-text-sm tw-text-slate-300 focus:tw-border-slate-500 focus:tw-outline-none"
            />
            {upload ? (
              <div className="tw-flex tw-items-center tw-justify-between tw-rounded-xl tw-border tw-border-slate-800 tw-bg-slate-950 tw-px-4 tw-py-3">
                <div>
                  <p className="tw-text-sm tw-font-medium tw-text-slate-100">{upload.name}</p>
                  <p className="tw-text-xs tw-text-slate-400">{upload.sizeLabel}</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setUpload(null);
                    setRoadmap("");
                    setSuccess(null);
                    setUploadKey((value) => value + 1);
                    setHandoffNotice(null);
                    setHandoffError(null);
                  }}
                  className="tw-text-xs tw-font-semibold tw-text-slate-300 hover:tw-text-slate-100"
                >
                  Remove
                </button>
              </div>
            ) : (
              <p className="tw-text-xs tw-text-slate-400">
                Accepts .yml or .yaml files up to 2MB. We validate the file with js-yaml before committing it to your repository.
              </p>
            )}
          </div>

          {hasRoadmap ? (
            <div className="tw-space-y-2">
              <div className="tw-flex tw-items-center tw-justify-between">
                <h2 className="tw-text-base tw-font-semibold tw-text-slate-200">Preview</h2>
                <span className="tw-text-xs tw-font-medium tw-text-emerald-400">Validated ✓</span>
              </div>
              <pre className="tw-max-h-72 tw-overflow-auto tw-rounded-2xl tw-border tw-border-slate-800 tw-bg-slate-950 tw-p-4 tw-text-xs tw-leading-relaxed tw-text-slate-200">
                <code>{roadmapPreview}</code>
              </pre>
            </div>
          ) : null}

          {error ? (
            <div className="tw-rounded-2xl tw-border tw-border-rose-800 tw-bg-rose-950/40 tw-p-4">
              <h3 className="tw-text-sm tw-font-semibold tw-text-rose-200">{error.title}</h3>
              {error.detail ? <p className="tw-text-xs tw-text-rose-300 tw-mt-1">{error.detail}</p> : null}
            </div>
          ) : null}

          {success ? (
            <div className="tw-rounded-2xl tw-border tw-border-emerald-700 tw-bg-emerald-950/40 tw-p-4 tw-space-y-4">
              <div className="tw-space-y-1">
                <h3 className="tw-text-sm tw-font-semibold tw-text-emerald-200">Roadmap imported successfully</h3>
                <p className="tw-text-xs tw-text-emerald-100">
                  Created {success.created.length} files
                  {success.skipped.length ? `, skipped ${success.skipped.length} existing` : ""}.
                </p>
                {success.branch ? (
                  <p className="tw-text-xs tw-text-emerald-200/80">
                    Changes pushed to <code className="tw-font-mono tw-text-[11px]">{success.branch}</code>.
                  </p>
                ) : null}
                <p className="tw-text-xs tw-text-emerald-100/80">
                  The follow-up run commits <code className="tw-font-mono tw-text-[11px]">{statusPath}</code> and <code className="tw-font-mono tw-text-[11px]">{planPath}</code> so the dashboard loads immediately.
                </p>
              </div>

              <div className="tw-space-y-3 tw-rounded-2xl tw-border tw-border-slate-800 tw-bg-slate-900/70 tw-p-4">
                <div className="tw-space-y-1">
                  <p className="tw-text-sm tw-font-semibold tw-text-slate-100">Status &amp; plan follow-up</p>
                  <p className="tw-text-xs tw-text-slate-300">
                    We automatically run <code className="tw-font-mono tw-text-[11px]">/api/run</code> against this branch to publish the dashboard prerequisites.
                  </p>
                </div>
                {isRunningRun ? (
                  <div className="tw-inline-flex tw-items-center tw-gap-2 tw-rounded-full tw-border tw-border-emerald-400/40 tw-bg-emerald-500/10 tw-px-3 tw-py-1.5">
                    <span className="tw-h-3 tw-w-3 tw-animate-spin tw-rounded-full tw-border-2 tw-border-emerald-300 tw-border-t-transparent" />
                    <span className="tw-text-xs tw-font-semibold tw-text-emerald-100">Generating dashboard artifacts…</span>
                  </div>
                ) : null}
                {runNotice ? (
                  <div className="tw-space-y-2 tw-rounded-xl tw-border tw-border-emerald-500/40 tw-bg-emerald-500/10 tw-px-3 tw-py-2">
                    <p className="tw-text-xs tw-font-semibold tw-text-emerald-100">{runNotice}</p>
                    <ul className="tw-space-y-1">
                      <li className="tw-flex tw-items-center tw-gap-2">
                        <span className="tw-text-xs">{hasStatusArtifact ? "✅" : "•"}</span>
                        <code className="tw-font-mono tw-text-[11px] tw-text-emerald-100/90">{statusPath}</code>
                      </li>
                      <li className="tw-flex tw-items-center tw-gap-2">
                        <span className="tw-text-xs">{hasPlanArtifact ? "✅" : "•"}</span>
                        <code className="tw-font-mono tw-text-[11px] tw-text-emerald-100/90">{planPath}</code>
                      </li>
                    </ul>
                    {distinctRunArtifacts.length > 2 ? (
                      <p className="tw-text-[11px] tw-text-emerald-100/70">
                        Additional artifacts: {distinctRunArtifacts.filter((artifact) => artifact !== statusPath && artifact !== planPath).join(", ")}
                      </p>
                    ) : null}
                  </div>
                ) : null}
                {runError ? (
                  <div className="tw-space-y-2 tw-rounded-xl tw-border tw-border-rose-700 tw-bg-rose-900/30 tw-px-3 tw-py-2">
                    <div>
                      <p className="tw-text-xs tw-font-semibold tw-text-rose-200">Status refresh failed</p>
                      <p className="tw-text-[11px] tw-text-rose-200/80">{runError}</p>
                    </div>
                    <button
                      type="button"
                      onClick={handleRunRetry}
                      className="tw-inline-flex tw-items-center tw-gap-2 tw-rounded-full tw-border tw-border-rose-500 tw-bg-rose-500/10 tw-px-3 tw-py-1.5 tw-text-xs tw-font-semibold tw-text-rose-100 hover:tw-bg-rose-500/20"
                    >
                      Retry status run
                    </button>
                  </div>
                ) : null}
                {!isRunningRun && !runNotice && !runError ? (
                  <p className="tw-text-xs tw-text-slate-400">Awaiting status refresh…</p>
                ) : null}
              </div>

              {success.prUrl ? (
                <a
                  href={success.prUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="tw-inline-flex tw-items-center tw-gap-2 tw-rounded-full tw-border tw-border-emerald-500 tw-bg-emerald-600/10 tw-px-3 tw-py-1.5 tw-text-xs tw-font-semibold tw-text-emerald-100 hover:tw-bg-emerald-600/20"
                >
                  View {success.pullRequestNumber ? `PR #${success.pullRequestNumber}` : "pull request"}
                  <span aria-hidden="true">↗</span>
                </a>
              ) : null}
              {dashboardHref ? (
                <Link
                  href={dashboardHref}
                  className="tw-inline-flex tw-items-center tw-gap-2 tw-rounded-full tw-border tw-border-emerald-500 tw-bg-emerald-600/10 tw-px-3 tw-py-1.5 tw-text-xs tw-font-semibold tw-text-emerald-100 hover:tw-bg-emerald-600/20"
                >
                  View dashboard
                  <span aria-hidden="true">↗</span>
                </Link>
              ) : null}
            </div>
          ) : null}

          <div className="tw-flex tw-flex-wrap tw-items-center tw-gap-3">
            <button
              type="submit"
              disabled={!canSubmit}
              className="tw-inline-flex tw-items-center tw-justify-center tw-rounded-full tw-bg-slate-100 tw-px-5 tw-py-2.5 tw-text-sm tw-font-semibold tw-text-slate-900 tw-transition tw-duration-200 tw-ease-out disabled:tw-cursor-not-allowed disabled:tw-bg-slate-500/50"
            >
              {isSubmitting ? "Importing…" : "Import & scaffold"}
            </button>
            <label className="tw-inline-flex tw-items-center tw-gap-2 tw-rounded-full tw-border tw-border-slate-800 tw-bg-slate-950/60 tw-px-3 tw-py-1.5 tw-text-xs tw-font-medium tw-text-slate-200">
              <input
                type="checkbox"
                checked={openAsPr}
                onChange={(event) => setOpenAsPr(event.target.checked)}
                className="tw-h-3.5 tw-w-3.5 tw-rounded tw-border tw-border-slate-700 tw-bg-slate-900 tw-text-emerald-400 focus:tw-ring-emerald-400"
              />
              <span>Open as pull request</span>
            </label>
            <p className="tw-text-xs tw-text-slate-400">
              {openAsPr
                ? "Creates a new branch and opens a PR with the roadmap scaffolding."
                : `Commits docs/roadmap.yml, scaffolding, and status artifacts directly to ${success?.branch ?? branch}.`}
            </p>
          </div>
        </section>

        <aside className="tw-space-y-6 tw-rounded-3xl tw-border tw-border-slate-800 tw-bg-slate-950 tw-p-8">
          <div className="tw-space-y-2">
            <h2 className="tw-text-lg tw-font-semibold tw-text-slate-100">What gets created</h2>
            <p className="tw-text-sm tw-text-slate-300">
              In addition to syncing docs/roadmap.yml, we provision supporting files that keep your roadmap connected to infra, tech stack, and automation workflows.
            </p>
          </div>
          <ul className="tw-space-y-4">
            <li className="tw-rounded-2xl tw-border tw-border-slate-800 tw-bg-slate-900 tw-p-4">
              <h3 className="tw-text-sm tw-font-semibold tw-text-slate-100">docs/infra-facts.md</h3>
              <p className="tw-text-xs tw-text-slate-300">
                Capture deployment constraints, database configuration, and escalation paths so handoffs stay smooth once build work begins.
              </p>
            </li>
            <li className="tw-rounded-2xl tw-border tw-border-slate-800 tw-bg-slate-900 tw-p-4">
              <h3 className="tw-text-sm tw-font-semibold tw-text-slate-100">docs/tech-stack.yml</h3>
              <p className="tw-text-xs tw-text-slate-300">
                Fill in frameworks, services, and integrations to give AI copilots and collaborators a consistent view of your stack.
              </p>
            </li>
            <li className="tw-rounded-2xl tw-border tw-border-slate-800 tw-bg-slate-900 tw-p-4">
              <h3 className="tw-text-sm tw-font-semibold tw-text-slate-100">.github/workflows/roadmap.yml</h3>
              <p className="tw-text-xs tw-text-slate-300">
                Runs roadmap checks on pushes and pull requests, wiring status updates into the dashboard.
              </p>
            </li>
          </ul>
          <div className="tw-rounded-2xl tw-border tw-border-slate-800 tw-bg-slate-900 tw-p-4 tw-space-y-2">
            <h3 className="tw-text-sm tw-font-semibold tw-text-slate-100">Need the dashboard link?</h3>
            <p className="tw-text-xs tw-text-slate-300">
              After import, jump straight to the live dashboard for this repository to confirm status feeds and roadmap context are flowing.
            </p>
            {dashboardHref ? (
              <Link
                href={dashboardHref}
                className="tw-inline-flex tw-items-center tw-gap-2 tw-rounded-full tw-border tw-border-slate-700 tw-bg-slate-900 tw-px-3 tw-py-1.5 tw-text-xs tw-font-semibold tw-text-slate-200 hover:tw-border-slate-500"
              >
                Open {success?.owner}/{success?.repo}
                <span aria-hidden="true">↗</span>
              </Link>
            ) : (
              <p className="tw-text-xs tw-text-slate-500">Link will appear after a successful import.</p>
            )}
          </div>
        </aside>
      </form>
    </div>
  );
}

function RoadmapProvisionerPage() {
  return (
    <Suspense fallback={<div className="tw-text-slate-300">Loading roadmap wizard…</div>}>
      <RoadmapProvisionerInner />
    </Suspense>
  );
}

export default RoadmapProvisionerPage;
