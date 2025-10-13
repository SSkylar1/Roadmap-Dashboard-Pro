"use client";

import {
  ChangeEvent,
  FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";

import { describeProjectFile, normalizeProjectKey } from "@/lib/project-paths";
import { mergeProjectOptions } from "@/lib/project-options";
import { removeProjectFromStore, removeRepoFromStore } from "@/lib/secrets-actions";
import { useLocalSecrets, useResolvedSecrets } from "@/lib/use-local-secrets";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type ChatResponse = {
  conversationId: string;
  reply: string;
};

type ErrorState = {
  title: string;
  detail?: string;
};

type PromoteResponse = {
  ok: boolean;
  path?: string;
  label?: string;
  owner?: string;
  repo?: string;
  branch?: string;
  promotedBranch?: string;
  project?: string | null;
  prUrl?: string;
  pullRequestNumber?: number;
  error?: string;
  detail?: string;
};

type WizardHandoffPayload = {
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
  createdAt: number;
};

type PromoteSuccess = {
  path: string;
  label: string;
  owner: string;
  repo: string;
  branch: string;
  promotedBranch: string;
  project?: string | null;
  prUrl?: string;
  pullRequestNumber?: number;
};

function formatTranscript(messages: ChatMessage[]): string {
  return messages
    .map((message, index) => {
      const speaker = message.role === "user" ? "Founder" : "AI Partner";
      const formattedContent = message.content.replace(/\n/g, "\n  ");
      return `${index + 1}. **${speaker}:** ${formattedContent}`;
    })
    .join("\n");
}

const CONCEPT_HANDOFF_KEY = "wizard:handoff:concept";
const ADD_NEW_REPO_OPTION = "__add_new_repo__";
const ADD_NEW_PROJECT_OPTION = "__add_new_project__";

function emphasizeLead(line: string): ReactNode {
  const colonIndex = line.indexOf(":");
  if (colonIndex <= 0) {
    return line;
  }
  const lead = line.slice(0, colonIndex).trim();
  const rest = line.slice(colonIndex + 1).trim();
  if (!lead || !rest) {
    return line;
  }
  return (
    <>
      <span className="tw-text-sky-200 tw-font-semibold">{lead}:</span>{" "}
      <span className="tw-text-slate-200">{rest}</span>
    </>
  );
}

function renderAssistantContent(content: string): ReactNode {
  const sections = content
    .split(/\n\s*\n/)
    .map((section) => section.trim())
    .filter(Boolean);

  if (sections.length === 0) {
    return null;
  }

  return (
    <div className="tw-space-y-5">
      {sections.map((section, sectionIndex) => {
        const rawLines = section
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean);
        if (rawLines.length === 0) {
          return null;
        }

        const isNumberedList = rawLines.every((line) => /^\d+[\).]\s+/.test(line));
        const isBulletedList = rawLines.every((line) => /^[-*•]\s+/.test(line));

        if (isNumberedList || isBulletedList) {
          const listItems = rawLines.map((line, lineIndex) => {
            const cleaned = isNumberedList
              ? line.replace(/^\d+[\).]\s*/, "")
              : line.replace(/^[-*•]\s*/, "");
            return (
              <li key={lineIndex} className="tw-leading-relaxed tw-text-[15px] tw-text-slate-100">
                {emphasizeLead(cleaned)}
              </li>
            );
          });

          if (isNumberedList) {
            return (
              <ol key={sectionIndex} className="tw-list-decimal tw-space-y-2 tw-pl-6 tw-marker:tw-text-sky-300">
                {listItems}
              </ol>
            );
          }

          return (
            <ul key={sectionIndex} className="tw-list-disc tw-space-y-2 tw-pl-6 tw-marker:tw-text-sky-400">
              {listItems}
            </ul>
          );
        }

        if (rawLines.length > 1) {
          const [firstLine, ...rest] = rawLines;
          return (
            <div key={sectionIndex} className="tw-space-y-2">
              <p className="tw-text-xs tw-font-semibold tw-uppercase tw-tracking-widest tw-text-sky-300">
                {firstLine.replace(/[:：]\s*$/, "")}
              </p>
              {rest.map((line, idx) => (
                <p key={idx} className="tw-text-base tw-leading-relaxed tw-text-slate-100">
                  {emphasizeLead(line)}
                </p>
              ))}
            </div>
          );
        }

        return (
          <p key={sectionIndex} className="tw-text-base tw-leading-relaxed tw-text-slate-100">
            {emphasizeLead(rawLines[0])}
          </p>
        );
      })}
    </div>
  );
}

export default function BrainstormPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<ErrorState | null>(null);
  const [promoteMessage, setPromoteMessage] = useState<string | null>(null);
  const [promoteResult, setPromoteResult] = useState<PromoteSuccess | null>(null);
  const [handoffPath, setHandoffPath] = useState<string | null>(null);
  const [isPromoting, setIsPromoting] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const secretsStore = useLocalSecrets();
  const repoEntries = secretsStore.repos;
  const [owner, setOwner] = useState("");
  const [repo, setRepo] = useState("");
  const [branch, setBranch] = useState("main");
  const [project, setProject] = useState("");
  const [selectedRepoId, setSelectedRepoId] = useState<string>(ADD_NEW_REPO_OPTION);
  const [selectedProjectOption, setSelectedProjectOption] = useState<string>("");
  const [discoveredProjectSlugs, setDiscoveredProjectSlugs] = useState<string[]>([]);
  const [projectSlugsLoading, setProjectSlugsLoading] = useState(false);
  const [projectSlugsError, setProjectSlugsError] = useState<string | null>(null);
  const [openAsPr, setOpenAsPr] = useState(false);
  const [initialContextLoaded, setInitialContextLoaded] = useState(false);
  const [isRemovingRepo, setIsRemovingRepo] = useState(false);
  const [removeRepoError, setRemoveRepoError] = useState<string | null>(null);
  const [isRemovingProject, setIsRemovingProject] = useState(false);
  const [removeProjectError, setRemoveProjectError] = useState<string | null>(null);

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

  const projectOptions = useMemo(
    () => mergeProjectOptions(matchedRepoEntry?.projects, discoveredProjectSlugs),
    [matchedRepoEntry?.projects, discoveredProjectSlugs],
  );

  const selectedProjectMeta = useMemo(
    () => projectOptions.find((option) => option.id === selectedProjectOption) ?? null,
    [projectOptions, selectedProjectOption],
  );

  const projectKey = useMemo(() => normalizeProjectKey(project), [project]);
  const secrets = useResolvedSecrets(owner, repo, project || undefined);
  const openAiConfigured = Boolean(secrets.openaiKey);
  const githubConfigured = Boolean(secrets.githubPat);

  useEffect(() => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  useEffect(() => {
    if (initialContextLoaded || typeof window === "undefined") {
      return;
    }

    try {
      const storedRaw = window.localStorage.getItem(CONCEPT_HANDOFF_KEY);
      if (storedRaw) {
        const stored = JSON.parse(storedRaw) as WizardHandoffPayload;
        if (stored.owner) {
          setOwner((current) => current || stored.owner!);
        }
        if (stored.repo) {
          setRepo((current) => current || stored.repo!);
        }
        if (stored.branch) {
          setBranch((current) => (current && current !== "main" ? current : stored.branch!));
        }
        if (stored.project) {
          setProject((current) => current || stored.project!);
        }
      }
    } catch (storeError) {
      console.error("Failed to restore brainstorm context", storeError);
    } finally {
      setInitialContextLoaded(true);
    }
  }, [initialContextLoaded]);

  useEffect(() => {
    if (!initialContextLoaded) {
      return;
    }
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
  }, [initialContextLoaded, owner, repo, project, repoEntries]);

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
    if (!project) {
      setSelectedProjectOption((current) => (current === "" ? current : ""));
      return;
    }
    const match = projectOptions.find((option) => option.id === project);
    const optionValue = match ? match.id : ADD_NEW_PROJECT_OPTION;
    setSelectedProjectOption((current) => (current === optionValue ? current : optionValue));
  }, [project, projectOptions]);

  useEffect(() => {
    setRemoveRepoError(null);
  }, [selectedRepoId, matchedRepoEntry?.id]);

  useEffect(() => {
    setRemoveProjectError(null);
  }, [selectedProjectOption, matchedRepoEntry?.id]);

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
      setProject((current) => current || "");
      return;
    }
    const match = projectOptions.find((option) => option.id === value);
    if (match) {
      setProject(match.id);
    }
  };

  const handleRemoveRepo = async () => {
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
      setProject("");
      setSelectedRepoId(ADD_NEW_REPO_OPTION);
      setSelectedProjectOption("");
    } catch (removeError) {
      setRemoveRepoError(
        removeError instanceof Error ? removeError.message : String(removeError ?? "Failed to remove repository"),
      );
    } finally {
      setIsRemovingRepo(false);
    }
  };

  const handleRemoveProject = async () => {
    if (!matchedRepoEntry || !selectedProjectMeta || selectedProjectMeta.source !== "stored") {
      return;
    }
    const projectEntry = matchedRepoEntry.projects.find((entry) => entry.id === selectedProjectMeta.id);
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
      setProject("");
      setSelectedProjectOption("");
    } catch (removeError) {
      setRemoveProjectError(
        removeError instanceof Error ? removeError.message : String(removeError ?? "Failed to remove project"),
      );
    } finally {
      setIsRemovingProject(false);
    }
  };

  const hasMessages = messages.length > 0;

  const placeholder = useMemo(
    () =>
      "Describe the spark you want to explore, customer pain points, or constraints. The ideation partner will help you expand it.",
    [],
  );

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPromoteMessage(null);
    setPromoteResult(null);

    const trimmed = input.trim();
    if (!trimmed) {
      return;
    }

    const pendingHistory = messages;
    const payload = {
      conversationId,
      history: pendingHistory,
      message: trimmed,
    };

    setMessages((prev) => [...prev, { role: "user", content: trimmed }]);
    setInput("");
    setIsSending(true);
    setError(null);

    try {
      const headers: HeadersInit = {
        "Content-Type": "application/json",
      };
      if (secrets.openaiKey) {
        headers["x-openai-key"] = secrets.openaiKey;
      }

      const response = await fetch("/api/brainstorm/chat", {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const detail = await response.json().catch(() => ({}));
        const title = typeof detail.error === "string" ? detail.error : "We could not reach OpenAI.";
        const info = typeof detail.detail === "string" ? detail.detail : undefined;
        setError({ title, detail: info });
        setMessages((prev) => prev.slice(0, -1));
        return;
      }

      const data = (await response.json()) as ChatResponse;
      setConversationId(data.conversationId);
      setMessages((prev) => [...prev, { role: "assistant", content: data.reply }]);
    } catch (err) {
      setError({ title: "Something went wrong sending your idea.", detail: err instanceof Error ? err.message : undefined });
      setMessages((prev) => prev.slice(0, -1));
    } finally {
      setIsSending(false);
    }
  }

  const targetLabel = describeProjectFile("docs/idea-log.md", projectKey);
  const canPromote = Boolean(!isPromoting && hasMessages && owner.trim() && repo.trim() && branch.trim());

  async function handlePromote() {
    if (!hasMessages) {
      return;
    }

    if (!owner.trim() || !repo.trim()) {
      setError({ title: "Connect a repository", detail: "Select an owner and repo before promoting your idea log." });
      return;
    }

    setIsPromoting(true);
    setPromoteMessage(null);
    setPromoteResult(null);
    setError(null);

    try {
      const headers: HeadersInit = {
        "Content-Type": "application/json",
      };
      if (secrets.githubPat) {
        headers["x-github-pat"] = secrets.githubPat;
      }

      const response = await fetch("/api/brainstorm/promote", {
        method: "POST",
        headers,
        body: JSON.stringify({
          conversationId,
          messages,
          owner,
          repo,
          branch: branch || "main",
          project: project || undefined,
          openAsPr,
        }),
      });

      const detail = (await response.json().catch(() => ({}))) as PromoteResponse;

      if (!response.ok || !detail?.ok) {
        const title = typeof detail?.error === "string" ? detail.error : "Failed to promote idea to project.";
        const info = typeof detail?.detail === "string" ? detail.detail : undefined;
        setError({ title, detail: info });
        return;
      }

      const label = detail.label ?? targetLabel;
      const basePath = detail.path ?? "docs/idea-log.md";
      const baseBranch = detail.branch ?? (branch || "main");
      const resolvedBranch = detail.promotedBranch || baseBranch;
      const projectValue = detail.project ?? (projectKey ?? null);
      const success: PromoteSuccess = {
        path: basePath,
        label,
        owner: detail.owner ?? owner,
        repo: detail.repo ?? repo,
        branch: baseBranch,
        promotedBranch: resolvedBranch,
        project: projectValue,
        prUrl: detail.prUrl,
        pullRequestNumber: detail.pullRequestNumber,
      };

      setPromoteResult(success);
      setHandoffPath(basePath);

      if (detail.prUrl) {
        const prLabel = detail.pullRequestNumber ? `PR #${detail.pullRequestNumber}` : "Pull request";
        setPromoteMessage(`${prLabel} opened for ${label}.`);
      } else {
        setPromoteMessage(`${label} updated on ${resolvedBranch}.`);
      }

      try {
        const payload: WizardHandoffPayload = {
          path: basePath,
          label,
          content: formatTranscript(messages),
          owner: success.owner,
          repo: success.repo,
          branch: baseBranch,
          promotedBranch: resolvedBranch,
          project: projectValue,
          prUrl: detail.prUrl,
          pullRequestNumber: detail.pullRequestNumber,
          createdAt: Date.now(),
        };
        if (typeof window !== "undefined") {
          window.localStorage.setItem(CONCEPT_HANDOFF_KEY, JSON.stringify(payload));
        }
      } catch (storeError) {
        console.error("Failed to persist wizard handoff", storeError);
      }
    } catch (err) {
      setError({ title: "Promotion failed", detail: err instanceof Error ? err.message : undefined });
    } finally {
      setIsPromoting(false);
    }
  }

  const conceptLink = useMemo(() => {
    if (!handoffPath) {
      return null;
    }
    const params = new URLSearchParams({ handoff: handoffPath });
    if (promoteResult?.owner) {
      params.set("owner", promoteResult.owner);
    } else if (owner.trim()) {
      params.set("owner", owner.trim());
    }
    if (promoteResult?.repo) {
      params.set("repo", promoteResult.repo);
    } else if (repo.trim()) {
      params.set("repo", repo.trim());
    }
    if (branch.trim()) {
      params.set("branch", branch.trim());
    }
    if (project.trim()) {
      params.set("project", project.trim());
    }
    return `/wizard/concept/workspace?${params.toString()}`;
  }, [handoffPath, promoteResult, owner, repo, branch, project]);

  return (
    <section className="tw-space-y-8">
      <div className="tw-space-y-3">
        <Link
          href="/wizard/new-idea"
          className="tw-inline-flex tw-items-center tw-gap-2 tw-text-sm tw-text-slate-300 tw-transition tw-duration-200 tw-ease-out hover:tw-text-slate-100"
        >
          <span aria-hidden="true">←</span>
          <span>Back to ideation playbook</span>
        </Link>
        <h1 className="tw-text-3xl tw-font-bold tw-leading-tight tw-text-slate-100">Idea Workspace</h1>
        <p className="tw-text-lg tw-leading-relaxed tw-text-slate-300">
          Capture every spark in a persistent chat, let AI riff with you, and convert the best ideas into roadmap-ready context.
        </p>
        <div className="tw-flex tw-flex-wrap tw-gap-3">
          <span className="tw-text-xs tw-font-medium tw-uppercase tw-tracking-wide tw-text-slate-400">
            {openAiConfigured ? "OpenAI ready" : "Add an OpenAI key in Settings"}
          </span>
          <span className="tw-text-xs tw-font-medium tw-uppercase tw-tracking-wide tw-text-slate-400">
            {githubConfigured ? "GitHub token ready" : "Add a GitHub PAT in Settings"}
          </span>
        </div>
      </div>

      <div className="tw-space-y-4 tw-rounded-3xl tw-border tw-border-slate-800 tw-bg-slate-900 tw-p-6">
        <div className="tw-flex tw-flex-wrap tw-items-center tw-justify-between tw-gap-3">
          <div className="tw-space-y-1">
            <h2 className="tw-text-base tw-font-semibold tw-text-slate-100">Promote this brainstorm into your repo</h2>
            <p className="tw-text-xs tw-text-slate-400">
              Exports append to <code className="tw-text-[11px]">{targetLabel}</code> so the next playbook can import it.
            </p>
          </div>
          <button
            type="button"
            className="tw-inline-flex tw-items-center tw-gap-2 tw-rounded-full tw-border tw-border-slate-800 tw-bg-slate-900 tw-px-4 tw-py-2 tw-text-sm tw-font-medium tw-text-slate-100 tw-transition tw-duration-200 tw-ease-out hover:tw-border-slate-700 disabled:tw-opacity-60"
            onClick={handlePromote}
            disabled={!canPromote || isPromoting}
          >
            {isPromoting ? "Promoting…" : openAsPr ? "Promote via PR" : "Promote to Project"}
          </button>
        </div>

        <div className="tw-grid tw-gap-3 md:tw-grid-cols-2 xl:tw-grid-cols-4">
          <label className="tw-flex tw-flex-col tw-gap-1">
            <span className="tw-text-xs tw-font-semibold tw-uppercase tw-tracking-wide tw-text-slate-400">Linked repository</span>
            <select
              value={selectedRepoId}
              onChange={handleRepoSelect}
              className="tw-w-full tw-rounded-xl tw-border tw-border-slate-800 tw-bg-slate-950/70 tw-px-3 tw-py-2 tw-text-sm tw-text-slate-100 focus:tw-border-slate-600"
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
            {matchedRepoEntry && selectedRepoId !== ADD_NEW_REPO_OPTION ? (
              <div className="tw-flex tw-flex-wrap tw-items-center tw-gap-3 tw-pt-1">
                <button
                  type="button"
                  onClick={handleRemoveRepo}
                  disabled={isRemovingRepo}
                  className="tw-text-xs tw-font-semibold tw-uppercase tw-tracking-wide tw-text-rose-300 hover:tw-text-rose-100"
                >
                  {isRemovingRepo ? "Removing…" : "Remove repo"}
                </button>
                {removeRepoError ? (
                  <span className="tw-text-xs tw-text-rose-300">{removeRepoError}</span>
                ) : null}
              </div>
            ) : null}
          </label>
          <label className="tw-flex tw-flex-col tw-gap-1">
            <span className="tw-text-xs tw-font-semibold tw-uppercase tw-tracking-wide tw-text-slate-400">Branch</span>
            <input
              value={branch}
              onChange={(event) => setBranch(event.target.value)}
              placeholder="main"
              className="tw-w-full tw-rounded-xl tw-border tw-border-slate-800 tw-bg-slate-950/70 tw-px-3 tw-py-2 tw-text-sm tw-text-slate-100 focus:tw-border-slate-600"
            />
          </label>
          <label className="tw-flex tw-flex-col tw-gap-1">
            <span className="tw-text-xs tw-font-semibold tw-uppercase tw-tracking-wide tw-text-slate-400">Project (optional)</span>
            <select
              value={selectedProjectOption}
              onChange={handleProjectSelect}
              className="tw-w-full tw-rounded-xl tw-border tw-border-slate-800 tw-bg-slate-950/70 tw-px-3 tw-py-2 tw-text-sm tw-text-slate-100 focus:tw-border-slate-600"
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
            {matchedRepoEntry && selectedProjectMeta?.source === "stored" ? (
              <div className="tw-flex tw-flex-wrap tw-items-center tw-gap-3 tw-pt-1">
                <button
                  type="button"
                  onClick={handleRemoveProject}
                  disabled={isRemovingProject}
                  className="tw-text-xs tw-font-semibold tw-uppercase tw-tracking-wide tw-text-rose-300 hover:tw-text-rose-100"
                >
                  {isRemovingProject ? "Removing…" : "Remove project"}
                </button>
                {removeProjectError ? (
                  <span className="tw-text-xs tw-text-rose-300">{removeProjectError}</span>
                ) : null}
              </div>
            ) : null}
          </label>
          <div className="tw-flex tw-flex-col tw-gap-1">
            <span className="tw-text-xs tw-font-semibold tw-uppercase tw-tracking-wide tw-text-slate-400">Pull request</span>
            <label className="tw-inline-flex tw-items-center tw-gap-2 tw-rounded-full tw-border tw-border-slate-800 tw-bg-slate-950/70 tw-px-3 tw-py-2 tw-text-xs tw-font-medium tw-text-slate-200">
              <input
                type="checkbox"
                checked={openAsPr}
                onChange={(event) => setOpenAsPr(event.target.checked)}
                className="tw-h-3.5 tw-w-3.5 tw-rounded tw-border tw-border-slate-700 tw-bg-slate-900 tw-text-emerald-400 focus:tw-ring-emerald-400"
              />
              <span>Open as PR</span>
            </label>
          </div>
        </div>

        {selectedRepoId === ADD_NEW_REPO_OPTION && (
          <div className="tw-grid tw-gap-3 md:tw-grid-cols-2">
            <label className="tw-flex tw-flex-col tw-gap-1">
              <span className="tw-text-xs tw-font-semibold tw-uppercase tw-tracking-wide tw-text-slate-400">Owner</span>
              <input
                value={owner}
                onChange={(event) => {
                  setOwner(event.target.value);
                  setSelectedRepoId(ADD_NEW_REPO_OPTION);
                }}
                placeholder="acme-co"
                className="tw-w-full tw-rounded-xl tw-border tw-border-slate-800 tw-bg-slate-950/70 tw-px-3 tw-py-2 tw-text-sm tw-text-slate-100 focus:tw-border-slate-600"
              />
            </label>
            <label className="tw-flex tw-flex-col tw-gap-1">
              <span className="tw-text-xs tw-font-semibold tw-uppercase tw-tracking-wide tw-text-slate-400">Repository</span>
              <input
                value={repo}
                onChange={(event) => {
                  setRepo(event.target.value);
                  setSelectedRepoId(ADD_NEW_REPO_OPTION);
                }}
                placeholder="product-app"
                className="tw-w-full tw-rounded-xl tw-border tw-border-slate-800 tw-bg-slate-950/70 tw-px-3 tw-py-2 tw-text-sm tw-text-slate-100 focus:tw-border-slate-600"
              />
            </label>
          </div>
        )}

        {selectedProjectOption === ADD_NEW_PROJECT_OPTION && (
          <label className="tw-flex tw-flex-col tw-gap-1">
            <span className="tw-text-xs tw-font-semibold tw-uppercase tw-tracking-wide tw-text-slate-400">Project slug</span>
            <input
              value={project}
              onChange={(event) => {
                setProject(event.target.value);
                setSelectedProjectOption(ADD_NEW_PROJECT_OPTION);
              }}
              placeholder="growth-experiments"
              className="tw-w-full tw-rounded-xl tw-border tw-border-slate-800 tw-bg-slate-950/70 tw-px-3 tw-py-2 tw-text-sm tw-text-slate-100 focus:tw-border-slate-600"
            />
          </label>
        )}
      </div>

      {error && (
        <div className="tw-rounded-2xl tw-border tw-border-red-500/40 tw-bg-red-500/10 tw-p-4 tw-text-sm tw-text-red-200">
          <p className="tw-font-semibold">{error.title}</p>
          {error.detail && <p className="tw-mt-1 tw-text-red-200">{error.detail}</p>}
        </div>
      )}

      {promoteMessage && promoteResult && (
        <div className="tw-space-y-3 tw-rounded-2xl tw-border tw-border-emerald-500/40 tw-bg-emerald-500/10 tw-p-4 tw-text-sm tw-text-emerald-200">
          <p>{promoteMessage}</p>
          <div className="tw-flex tw-flex-wrap tw-gap-3 tw-text-xs tw-text-emerald-100/80">
            <span>
              Repo <code className="tw-text-[11px]">{promoteResult.owner}/{promoteResult.repo}</code>
            </span>
            <span>
              File <code className="tw-text-[11px]">{promoteResult.label}</code>
            </span>
            <span>
              Branch <code className="tw-text-[11px]">{promoteResult.promotedBranch}</code>
            </span>
          </div>
          <div className="tw-flex tw-flex-wrap tw-items-center tw-gap-3">
            {conceptLink && (
              <Link
                href={conceptLink}
                className="tw-inline-flex tw-items-center tw-gap-2 tw-rounded-full tw-border tw-border-emerald-400 tw-bg-emerald-500/20 tw-px-3 tw-py-1.5 tw-text-xs tw-font-semibold tw-text-emerald-100 hover:tw-border-emerald-300 hover:tw-text-white"
              >
                Continue in roadmap drafting workspace
                <span aria-hidden="true">→</span>
              </Link>
            )}
            {promoteResult.prUrl && (
              <a
                href={promoteResult.prUrl}
                target="_blank"
                rel="noreferrer"
                className="tw-inline-flex tw-items-center tw-gap-2 tw-rounded-full tw-border tw-border-emerald-300/60 tw-bg-emerald-500/20 tw-px-3 tw-py-1.5 tw-text-xs tw-font-semibold tw-text-emerald-100 hover:tw-border-emerald-200 hover:tw-text-white"
              >
                Review pull request
              </a>
            )}
          </div>
        </div>
      )}

      <div className="tw-flex tw-flex-col tw-gap-4 tw-rounded-3xl tw-border tw-border-slate-800 tw-bg-slate-900 tw-p-6 tw-max-h-[60vh] tw-overflow-y-auto">
        {hasMessages ? (
          messages.map((message, index) => (
            <div
              key={`${message.role}-${index}`}
              className={
                message.role === "user"
                  ? "tw-ml-auto tw-max-w-[75%] tw-rounded-3xl tw-border tw-border-blue-500/40 tw-bg-blue-600/10 tw-px-4 tw-py-3 tw-text-sm tw-text-slate-100 tw-shadow-md tw-shadow-blue-900/40"
                  : "tw-mr-auto tw-max-w-[75%] tw-rounded-3xl tw-border tw-border-sky-500/40 tw-bg-gradient-to-br tw-from-slate-950 tw-via-slate-950/90 tw-to-slate-900 tw-px-5 tw-py-4 tw-text-sm tw-text-slate-200 tw-shadow-lg tw-shadow-sky-900/40"
              }
            >
              <p className="tw-text-xs tw-font-semibold tw-uppercase tw-tracking-wide tw-text-slate-400">
                {message.role === "user" ? "You" : "AI Partner"}
              </p>
              {message.role === "assistant" ? (
                <div className="tw-mt-3 tw-space-y-3">
                  {renderAssistantContent(message.content)}
                </div>
              ) : (
                <p className="tw-mt-1 tw-whitespace-pre-line tw-leading-relaxed">{message.content}</p>
              )}
            </div>
          ))
        ) : (
          <div className="tw-text-sm tw-text-slate-400">
            Start a conversation with your idea. The assistant will help you shape, expand, and stress-test it.
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={sendMessage} className="tw-space-y-3">
        <label htmlFor="brainstorm-input" className="tw-text-sm tw-font-medium tw-text-slate-200">
          Drop your next thought
        </label>
        <textarea
          id="brainstorm-input"
          className="tw-min-h-[140px] tw-rounded-3xl tw-border tw-border-slate-800 tw-bg-slate-950 tw-p-4 tw-text-sm tw-text-slate-100 focus:tw-border-slate-700"
          placeholder={placeholder}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          disabled={isSending}
        />
        <div className="tw-flex tw-items-center tw-justify-between">
          <p className="tw-text-xs tw-text-slate-400">
            {openAiConfigured ? (
              <span>Using your saved OpenAI key from Settings.</span>
            ) : (
              <span>
                Add an OpenAI key in <Link href="/settings">Settings</Link> so the assistant can respond.
              </span>
            )}
          </p>
          <button
            type="submit"
            className="tw-inline-flex tw-items-center tw-gap-2 tw-rounded-full tw-border tw-border-slate-800 tw-bg-blue-600/10 tw-px-4 tw-py-2 tw-text-sm tw-font-semibold tw-text-blue-200 tw-transition tw-duration-200 tw-ease-out hover:tw-border-blue-500/60 disabled:tw-opacity-60"
            disabled={isSending || !input.trim()}
          >
            {isSending ? "Thinking…" : "Send idea"}
          </button>
        </div>
      </form>
    </section>
  );
}
