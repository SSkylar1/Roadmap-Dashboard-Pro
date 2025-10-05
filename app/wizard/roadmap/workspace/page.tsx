"use client";

import {
  ChangeEvent,
  FormEvent,
  Suspense,
  useEffect,
  useMemo,
  useState,
} from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { load } from "js-yaml";

import { describeProjectFile, normalizeProjectKey } from "@/lib/project-paths";
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
} | null;

type UploadState = {
  name: string;
  sizeLabel: string;
};

type HandoffHint = {
  path: string;
  label?: string;
  content?: string;
};

const ROADMAP_HANDOFF_KEY = "wizard:handoff:roadmap";

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
  const secretsStore = useLocalSecrets();
  const secrets = useResolvedSecrets(owner, repo, project || undefined);
  const githubConfigured = Boolean(secrets.githubPat);
  const [openAsPr, setOpenAsPr] = useState(false);

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

      if (handoffParam) {
        if (stored && stored.path === handoffParam) {
          setHandoffHint({ path: stored.path, label: stored.label, content: stored.content });
        } else {
          setHandoffHint({ path: handoffParam });
        }
      } else if (stored?.path) {
        setHandoffHint({ path: stored.path, label: stored.label, content: stored.content });
      } else {
        setHandoffHint(null);
      }
    } catch (err) {
      console.error("Failed to read roadmap handoff", err);
      if (handoffParam) {
        setHandoffHint({ path: handoffParam });
      }
    }
  }, [handoffParam]);

  const repoEntries = secretsStore.repos;
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
  const roadmapPath = describeProjectFile("docs/roadmap.yml", projectKey);
  const infraPath = describeProjectFile("docs/infra-facts.md", projectKey);
  const stackPath = describeProjectFile("docs/tech-stack.yml", projectKey);
  const workflowPath = describeProjectFile(".github/workflows/roadmap.yml", projectKey);
  const projectOptions = useMemo(() => matchedRepoEntry?.projects ?? [], [matchedRepoEntry]);
  const activeProjectId = useMemo(() => {
    if (!project) return "";
    const matchById = projectOptions.find((option) => option.id === project);
    if (matchById) return matchById.id;
    const normalized = normalizeProjectKey(project);
    const matchByKey = projectOptions.find((option) => normalizeProjectKey(option.id) === normalized);
    return matchByKey?.id ?? project;
  }, [project, projectOptions]);
  const canSubmit = Boolean(!isSubmitting && owner && repo && branch && hasRoadmap);

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
        const response = await fetch(`/api/wizard/handoff?path=${encodeURIComponent(handoffHint.path)}`);
        const payload = await response.json().catch(() => ({}));

        if (!response.ok || !payload?.ok) {
          const title = typeof payload?.error === "string" ? payload.error : "Failed to import shared roadmap";
          setHandoffError(title);
          return;
        }

        content = typeof payload.content === "string" ? payload.content : "";
        name = typeof payload.name === "string" ? payload.name : name;
        sizeLabel = typeof payload.sizeLabel === "string" ? payload.sizeLabel : sizeLabel;
        const normalizedPath = typeof payload.path === "string" ? payload.path : handoffHint.path;
        const updatedHint: HandoffHint = {
          path: normalizedPath,
          label: name,
          content,
        };
        setHandoffHint(updatedHint);
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
    } catch (err) {
      setHandoffError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsImportingHandoff(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) {
      setError({ title: "Provide required fields", detail: "Upload a roadmap and fill owner/repo before continuing." });
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      const headers: HeadersInit = { "Content-Type": "application/json" };
      if (secrets.githubPat) {
        headers["x-github-pat"] = secrets.githubPat;
      }

      const endpoint = openAsPr ? "/api/roadmap/import?asPR=true" : "/api/roadmap/import";
      const response = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({ owner, repo, branch, roadmap, project: project || undefined }),
      });

      const payload = (await response.json().catch(() => ({}))) as ImportResponse;
      if (!response.ok || !payload?.ok) {
        const title = payload?.error ?? "Failed to import roadmap";
        setError({ title, detail: payload?.detail });
        return;
      }

      setSuccess({
        created: payload.created ?? [],
        skipped: payload.skipped ?? [],
        owner,
        repo,
        branch: payload.branch ?? branch,
        prUrl: payload.prUrl,
        pullRequestNumber: payload.pullRequestNumber,
      });
    } catch (err: any) {
      setError({ title: "Request failed", detail: err instanceof Error ? err.message : String(err) });
    } finally {
      setIsSubmitting(false);
    }
  }

  const projectQuery = projectKey ? `&project=${encodeURIComponent(projectKey)}` : "";
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
          <div className="tw-grid tw-gap-4 md:tw-grid-cols-3">
            <label className="tw-flex tw-flex-col tw-gap-2">
              <span className="tw-text-sm tw-font-medium tw-text-slate-200">Owner</span>
              <input
                value={owner}
                onChange={(event) => setOwner(event.target.value)}
                placeholder="acme-co"
                className="tw-w-full tw-rounded-xl tw-border tw-border-slate-700 tw-bg-slate-950 tw-px-3 tw-py-2 tw-text-sm tw-text-slate-100 tw-placeholder-slate-500 focus:tw-border-slate-500 focus:tw-outline-none"
              />
            </label>
            <label className="tw-flex tw-flex-col tw-gap-2">
              <span className="tw-text-sm tw-font-medium tw-text-slate-200">Repository</span>
              <input
                value={repo}
                onChange={(event) => setRepo(event.target.value)}
                placeholder="product-app"
                className="tw-w-full tw-rounded-xl tw-border tw-border-slate-700 tw-bg-slate-950 tw-px-3 tw-py-2 tw-text-sm tw-text-slate-100 tw-placeholder-slate-500 focus:tw-border-slate-500 focus:tw-outline-none"
              />
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
              <input
                value={project}
                onChange={(event) => setProject(event.target.value)}
                placeholder="growth-experiments"
                className="tw-w-full tw-rounded-xl tw-border tw-border-slate-700 tw-bg-slate-950 tw-px-3 tw-py-2 tw-text-sm tw-text-slate-100 tw-placeholder-slate-500 focus:tw-border-slate-500 focus:tw-outline-none"
              />
            </label>
          </div>

          {repoEntries.length > 0 && (
            <div className="tw-rounded-2xl tw-border tw-border-slate-800 tw-bg-slate-950/60 tw-p-4 tw-space-y-3">
              <div className="tw-flex tw-flex-wrap tw-items-center tw-justify-between tw-gap-3">
                <h3 className="tw-text-sm tw-font-semibold tw-text-slate-200">Linked repositories</h3>
                <p className="tw-text-xs tw-text-slate-400">Pick a repo to auto-fill owner, branch, and project details.</p>
              </div>
              <div className="tw-flex tw-flex-wrap tw-gap-2">
                {repoEntries.map((entry) => {
                  const label = entry.displayName?.trim() || `${entry.owner}/${entry.repo}`;
                  const entrySlug = `${entry.owner.toLowerCase()}/${entry.repo.toLowerCase()}`;
                  const isActive = repoSlug === entrySlug;
                  return (
                    <button
                      key={entry.id}
                      type="button"
                      onClick={() => {
                        setOwner(entry.owner);
                        setRepo(entry.repo);
                        if (entry.projects.length === 1) {
                          setProject(entry.projects[0].id);
                        }
                      }}
                      className={`tw-inline-flex tw-items-center tw-gap-2 tw-rounded-full tw-border tw-px-3 tw-py-1.5 tw-text-xs tw-font-semibold tw-transition tw-duration-200 tw-ease-out ${
                        isActive
                          ? "tw-border-emerald-500 tw-bg-emerald-600/10 tw-text-emerald-200"
                          : "tw-border-slate-700 tw-bg-slate-900 tw-text-slate-200 hover:tw-border-slate-600"
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {projectOptions.length > 0 && (
            <div className="tw-space-y-3 tw-rounded-2xl tw-border tw-border-slate-800 tw-bg-slate-950/60 tw-p-4">
              <div className="tw-flex tw-flex-wrap tw-items-center tw-justify-between tw-gap-3">
                <h3 className="tw-text-sm tw-font-semibold tw-text-slate-200">Projects in {matchedRepoEntry?.displayName ?? `${owner || "repo"}`}</h3>
                <p className="tw-text-xs tw-text-slate-400">Select a saved project or continue typing a new one above.</p>
              </div>
              <div className="tw-flex tw-flex-wrap tw-gap-2">
                {projectOptions.map((option) => {
                  const isActive = activeProjectId === option.id || project === option.id;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => setProject(option.id)}
                      className={`tw-inline-flex tw-items-center tw-gap-2 tw-rounded-full tw-border tw-px-3 tw-py-1.5 tw-text-xs tw-font-semibold tw-transition tw-duration-200 tw-ease-out ${
                        isActive
                          ? "tw-border-emerald-500 tw-bg-emerald-600/10 tw-text-emerald-200"
                          : "tw-border-slate-700 tw-bg-slate-900 tw-text-slate-200 hover:tw-border-slate-600"
                      }`}
                    >
                      {option.name}
                    </button>
                  );
                })}
              </div>
              <p className="tw-text-xs tw-text-slate-400">
                Target files include <code className="tw-font-mono tw-text-[11px]">{roadmapPath}</code>, <code className="tw-font-mono tw-text-[11px]">{infraPath}</code>,
                and <code className="tw-font-mono tw-text-[11px]">{stackPath}</code>.
              </p>
            </div>
          )}

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
            <div className="tw-rounded-2xl tw-border tw-border-emerald-700 tw-bg-emerald-950/40 tw-p-4 tw-space-y-3">
              <div>
                <h3 className="tw-text-sm tw-font-semibold tw-text-emerald-200">Roadmap imported successfully</h3>
                <p className="tw-text-xs tw-text-emerald-100">
                  Created {success.created.length} files
                  {success.skipped.length ? `, skipped ${success.skipped.length} existing` : ""}.
                </p>
                {success.branch ? (
                  <p className="tw-mt-1 tw-text-xs tw-text-emerald-200/80">
                    Changes pushed to <code className="tw-font-mono tw-text-[11px]">{success.branch}</code>.
                  </p>
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
                : `Commits docs/roadmap.yml and scaffolding directly to ${success?.branch ?? branch}.`}
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
