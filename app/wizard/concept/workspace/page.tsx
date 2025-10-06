"use client";

import {
  ChangeEvent,
  FormEvent,
  Suspense,
  UIEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { describeProjectFile, normalizeProjectKey } from "@/lib/project-paths";
import { useLocalSecrets, useResolvedSecrets } from "@/lib/use-local-secrets";

type ErrorState = { title: string; detail?: string } | null;
type SuccessState = { message: string; prUrl?: string; handoffPath?: string } | null;

type GenerateResponse = { roadmap: string };

type CommitResponse = {
  ok: boolean;
  branch?: string;
  path?: string;
  prUrl?: string;
  pullRequestNumber?: number;
  error?: string;
  detail?: string;
};

type UploadState = {
  name: string;
  sizeLabel: string;
};

type HandoffHint = {
  path: string;
  label?: string;
  content?: string;
};

const CONCEPT_HANDOFF_KEY = "wizard:handoff:concept";
const ROADMAP_HANDOFF_KEY = "wizard:handoff:roadmap";
const ADD_NEW_REPO_OPTION = "__add_new_repo__";
const ADD_NEW_PROJECT_OPTION = "__add_new_project__";

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function highlightYaml(value: string) {
  return value
    .split("\n")
    .map((line) => {
      if (!line) {
        return "";
      }

      const hashIndex = line.indexOf("#");
      let main = line;
      let comment = "";
      if (hashIndex !== -1) {
        main = line.slice(0, hashIndex);
        comment = line.slice(hashIndex);
      }

      const indentMatch = main.match(/^(\s*)/);
      const indent = indentMatch ? indentMatch[0] : "";
      let rest = main.slice(indent.length);
      let html = escapeHtml(indent);

      if (rest.startsWith("- ")) {
        html += '<span class="token-dash">- </span>';
        rest = rest.slice(2);
      }

      const keyMatch = rest.match(/^([^:]+):(.*)$/);
      if (keyMatch) {
        const [, key, rawValue] = keyMatch;
        const trimmedKey = key.trimEnd();
        const spacing = key.slice(trimmedKey.length);
        const valuePart = rawValue ?? "";
        html += `<span class="token-key">${escapeHtml(trimmedKey)}</span>`;
        if (spacing) {
          html += escapeHtml(spacing);
        }
        html += '<span class="token-colon">:</span>';
        if (valuePart.trim()) {
          html += `<span class="token-string">${escapeHtml(valuePart)}</span>`;
        } else if (valuePart) {
          html += escapeHtml(valuePart);
        }
      } else {
        html += escapeHtml(rest);
      }

      if (comment) {
        html += `<span class="token-comment">${escapeHtml(comment)}</span>`;
      }

      return html;
    })
    .join("\n");
}

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
  return `${value.toFixed(value < 10 && unitIndex > 0 ? 1 : 0)} ${units[unitIndex]}`;
}

function ConceptWizardPageInner() {
  const params = useSearchParams();
  const handoffParam = params.get("handoff");
  const [owner, setOwner] = useState(() => params.get("owner") ?? "");
  const [repo, setRepo] = useState(() => params.get("repo") ?? "");
  const [branch, setBranch] = useState(() => params.get("branch") ?? "main");
  const [project, setProject] = useState(() => params.get("project") ?? "");
  const [conceptText, setConceptText] = useState("");
  const [upload, setUpload] = useState<UploadState | null>(null);
  const [uploadText, setUploadText] = useState("");
  const [filePickerKey, setFilePickerKey] = useState(0);
  const [handoffHint, setHandoffHint] = useState<HandoffHint | null>(null);
  const [handoffNotice, setHandoffNotice] = useState<string | null>(null);
  const [handoffError, setHandoffError] = useState<string | null>(null);
  const [isImportingHandoff, setIsImportingHandoff] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [roadmap, setRoadmap] = useState("");
  const [error, setError] = useState<ErrorState>(null);
  const [success, setSuccess] = useState<SuccessState>(null);
  const [openAsPr, setOpenAsPr] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);
  const previewRef = useRef<HTMLPreElement | null>(null);
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const secretsStore = useLocalSecrets();
  const secrets = useResolvedSecrets(owner, repo, project || undefined);
  const openAiConfigured = Boolean(secrets.openaiKey);
  const githubConfigured = Boolean(secrets.githubPat);
  const repoEntries = secretsStore.repos;
  const [selectedRepoId, setSelectedRepoId] = useState<string>(ADD_NEW_REPO_OPTION);
  const [selectedProjectOption, setSelectedProjectOption] = useState<string>("");
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
  const projectOptions = useMemo(() => matchedRepoEntry?.projects ?? [], [matchedRepoEntry]);

  const combinedPrompt = useMemo(() => {
    if (conceptText && uploadText) {
      return `${conceptText.trim()}\n\nUploaded context:\n${uploadText.trim()}`;
    }
    if (conceptText) return conceptText.trim();
    if (uploadText) return uploadText.trim();
    return "";
  }, [conceptText, uploadText]);

  const highlighted = useMemo(() => highlightYaml(roadmap || ""), [roadmap]);

  const projectKey = normalizeProjectKey(project);

  useEffect(() => {
    const nextRepoId = matchedRepoEntry?.id ?? ADD_NEW_REPO_OPTION;
    setSelectedRepoId((current) => (current === nextRepoId ? current : nextRepoId));
  }, [matchedRepoEntry?.id]);

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

  useEffect(() => {
    if (previewRef.current && editorRef.current) {
      previewRef.current.scrollTop = editorRef.current.scrollTop;
      previewRef.current.scrollLeft = editorRef.current.scrollLeft;
    }
  }, [roadmap]);

  useEffect(() => {
    if (typeof window === "undefined") {
      if (handoffParam) {
        setHandoffHint({ path: handoffParam });
      }
      return;
    }

    try {
      const storedRaw = window.localStorage.getItem(CONCEPT_HANDOFF_KEY);
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
      console.error("Failed to read concept handoff", err);
      if (handoffParam) {
        setHandoffHint({ path: handoffParam });
      }
    }
  }, [handoffParam]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const trimmed = roadmap.trim();
    if (!trimmed) {
      window.localStorage.removeItem(ROADMAP_HANDOFF_KEY);
      return;
    }

    const label = describeProjectFile("docs/roadmap.yml", projectKey);
    const payload = {
      path: label,
      label,
      content: trimmed,
      createdAt: Date.now(),
    };

    try {
      window.localStorage.setItem(ROADMAP_HANDOFF_KEY, JSON.stringify(payload));
    } catch (err) {
      console.error("Failed to persist roadmap handoff", err);
    }
  }, [roadmap, projectKey]);

  const canGenerate = Boolean(!isGenerating && combinedPrompt);
  const targetPath = describeProjectFile("docs/roadmap.yml", projectKey);
  const canCommit = Boolean(!isCommitting && roadmap.trim() && owner && repo && branch);

  async function onGenerate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!combinedPrompt) {
      setError({ title: "Provide concept details", detail: "Paste text or upload a document before generating." });
      return;
    }

    setIsGenerating(true);
    setError(null);
    setSuccess(null);

    try {
      const headers: HeadersInit = { "Content-Type": "application/json" };
      if (secrets.openaiKey) {
        headers["x-openai-key"] = secrets.openaiKey;
      }

      const response = await fetch("/api/concept/generate", {
        method: "POST",
        headers,
        body: JSON.stringify({ prompt: combinedPrompt }),
      });

      if (!response.ok) {
        const detail = await response.json().catch(() => ({}));
        const title = typeof detail.error === "string" ? detail.error : "Failed to generate roadmap";
        const info = typeof detail.detail === "string" ? detail.detail : undefined;
        setError({ title, detail: info });
        return;
      }

      const data = (await response.json()) as GenerateResponse;
      setRoadmap(data.roadmap.trim());
      setSuccess({ message: "Draft roadmap ready. Review and edit before committing to your repo." });
    } catch (err) {
      setError({ title: "Generation failed", detail: err instanceof Error ? err.message : String(err) });
    } finally {
      setIsGenerating(false);
    }
  }

  function syncScroll(event: UIEvent<HTMLTextAreaElement>) {
    const target = event.currentTarget;
    if (previewRef.current) {
      previewRef.current.scrollTop = target.scrollTop;
      previewRef.current.scrollLeft = target.scrollLeft;
    }
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    setHandoffNotice(null);
    setHandoffError(null);
    const file = event.target.files?.[0];
    if (!file) {
      setUpload(null);
      setUploadText("");
      setFilePickerKey((value) => value + 1);
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setError({ title: "File too large", detail: "Limit uploads to 2MB text documents." });
      event.target.value = "";
      setFilePickerKey((value) => value + 1);
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === "string" ? reader.result : "";
      setUpload({ name: file.name, sizeLabel: formatBytes(file.size) });
      setUploadText(text.trim());
    };
    reader.onerror = () => {
      setError({ title: "Failed to read file", detail: "Try uploading a plain text or markdown document." });
      setUpload(null);
      setUploadText("");
      setFilePickerKey((value) => value + 1);
    };
    reader.readAsText(file);
  }

  function resetUpload() {
    setUpload(null);
    setUploadText("");
    setFilePickerKey((value) => value + 1);
    setHandoffNotice(null);
    setHandoffError(null);
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
          const title = typeof payload?.error === "string" ? payload.error : "Failed to import shared file";
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
          window.localStorage.setItem(CONCEPT_HANDOFF_KEY, JSON.stringify(storedPayload));
        }
      } else {
        sizeLabel = formatBytes(new TextEncoder().encode(content).length);
      }

      const trimmed = content.trim();
      if (!trimmed) {
        setHandoffError("Shared file is empty");
        return;
      }

      const effectiveSizeLabel = sizeLabel || formatBytes(new TextEncoder().encode(trimmed).length);
      setUpload({ name, sizeLabel: effectiveSizeLabel });
      setUploadText(trimmed);
      setFilePickerKey((value) => value + 1);
      setHandoffNotice(`Imported ${name} from ideation workspace.`);
    } catch (err) {
      setHandoffError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsImportingHandoff(false);
    }
  }

  async function onCommit() {
    if (!roadmap.trim()) {
      setError({ title: "Roadmap is empty", detail: "Generate or paste roadmap content before committing." });
      return;
    }
    if (!owner || !repo) {
      setError({ title: "Connect a repo", detail: "Provide owner and repo so the wizard can push docs/roadmap.yml." });
      return;
    }

    setIsCommitting(true);
    setError(null);
    setSuccess(null);

    try {
      const headers: HeadersInit = { "Content-Type": "application/json" };
      if (secrets.githubPat) {
        headers["x-github-pat"] = secrets.githubPat;
      }

      const endpoint = openAsPr ? "/api/concept/commit?asPR=true" : "/api/concept/commit";
      const response = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({ owner, repo, branch: branch || "main", content: roadmap, project: project || undefined }),
      });

      const detail = (await response.json().catch(() => ({}))) as CommitResponse;

      if (!response.ok) {
        const title = typeof detail?.error === "string" ? detail.error : "Commit failed";
        const info = typeof detail?.detail === "string" ? detail.detail : undefined;
        setError({ title, detail: info });
        return;
      }

      if (detail.ok) {
        const committedPath = typeof detail.path === "string" ? detail.path : targetPath;
        if (openAsPr) {
          if (detail.prUrl) {
            const label = detail.pullRequestNumber ? `PR #${detail.pullRequestNumber}` : "Pull request";
            setSuccess({
              message: `${label} opened for ${committedPath}.`,
              prUrl: detail.prUrl,
              handoffPath: committedPath,
            });
          } else {
            setSuccess({
              message: `Pull request opened for ${committedPath}. Check GitHub to review and merge.`,
              handoffPath: committedPath,
            });
          }
        } else {
          const targetBranch = detail.branch ?? branch;
          setSuccess({ message: `${committedPath} committed to ${targetBranch}.`, handoffPath: committedPath });
        }
      } else {
        setError({ title: detail?.error ?? "Unexpected response", detail: detail?.detail });
      }
    } catch (err) {
      setError({ title: "Commit failed", detail: err instanceof Error ? err.message : String(err) });
    } finally {
      setIsCommitting(false);
    }
  }

  return (
    <section className="tw-space-y-8">
      <div className="tw-space-y-3">
        <Link
          href="/wizard/concept"
          prefetch={false}
          className="tw-inline-flex tw-items-center tw-gap-2 tw-text-sm tw-text-slate-300 tw-transition tw-duration-200 tw-ease-out hover:tw-text-slate-100"
        >
          <span aria-hidden="true">←</span>
          <span>Back to roadmap playbook</span>
        </Link>
        <h1 className="tw-text-3xl tw-font-bold tw-leading-tight tw-text-slate-100">Concept to Roadmap</h1>
        <p className="tw-text-lg tw-leading-relaxed tw-text-slate-300">
          Paste your concept brief or upload research notes, generate a structured roadmap, and push docs/roadmap.yml to your repo.
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

      <form onSubmit={onGenerate} className="tw-grid tw-gap-6 tw-rounded-3xl tw-border tw-border-slate-800 tw-bg-slate-900 tw-p-6">
        <div className="tw-space-y-2">
          <label className="tw-text-sm tw-font-medium tw-text-slate-200">Concept notes</label>
          <textarea
            value={conceptText}
            onChange={(event) => setConceptText(event.target.value)}
            className="tw-min-h-[160px] tw-w-full tw-resize-y tw-rounded-2xl tw-border tw-border-slate-800 tw-bg-slate-950/80 tw-p-4 tw-text-sm tw-text-slate-100 tw-outline-none focus:tw-border-slate-600"
            placeholder="Paste the problem statement, audience, constraints, or existing brainstorming transcript."
          />
        </div>

        {handoffHint && (
          <div className="tw-space-y-2 tw-rounded-2xl tw-border tw-border-emerald-500/40 tw-bg-emerald-500/10 tw-p-4">
            <div className="tw-flex tw-flex-wrap tw-items-center tw-justify-between tw-gap-3">
              <div className="tw-space-y-1">
                <p className="tw-text-sm tw-font-semibold tw-text-emerald-100">
                  Use {handoffHint.label ?? handoffHint.path} from Ideation
                </p>
                <p className="tw-text-xs tw-text-emerald-100/80">
                  Pull the promoted brainstorm transcript into this step without re-uploading.
                </p>
              </div>
              <button
                type="button"
                onClick={importHandoff}
                disabled={isImportingHandoff}
                className="tw-inline-flex tw-items-center tw-gap-2 tw-rounded-full tw-border tw-border-emerald-400 tw-bg-emerald-500/20 tw-px-3 tw-py-1.5 tw-text-xs tw-font-semibold tw-uppercase tw-tracking-wide tw-text-emerald-100 hover:tw-border-emerald-300 hover:tw-text-white disabled:tw-opacity-60"
              >
                {isImportingHandoff ? "Importing…" : "Import file"}
              </button>
            </div>
            {handoffNotice && <p className="tw-text-xs tw-text-emerald-100/80">{handoffNotice}</p>}
            {handoffError && <p className="tw-text-xs tw-text-red-200">{handoffError}</p>}
          </div>
        )}

        <div className="tw-space-y-2">
          <label className="tw-text-sm tw-font-medium tw-text-slate-200">Or upload supporting brief</label>
          <div className="tw-flex tw-flex-wrap tw-items-center tw-justify-between tw-gap-3 tw-rounded-2xl tw-border tw-border-dashed tw-border-slate-700 tw-bg-slate-950/60 tw-p-4">
            <div className="tw-space-y-1">
              <p className="tw-text-sm tw-font-medium tw-text-slate-100">Attach markdown, text, or YAML exports</p>
              <p className="tw-text-xs tw-text-slate-400">.md, .txt, .json, .yaml up to 2MB</p>
              {upload && (
                <div className="tw-text-xs tw-text-slate-300">
                  {upload.name} <span className="tw-text-slate-500">({upload.sizeLabel})</span>
                </div>
              )}
            </div>
            <div className="tw-flex tw-items-center tw-gap-2">
              {upload && (
                <button
                  type="button"
                  onClick={resetUpload}
                  className="tw-inline-flex tw-items-center tw-gap-1 tw-rounded-full tw-border tw-border-slate-700 tw-bg-slate-900 tw-px-3 tw-py-1 tw-text-xs tw-font-medium tw-text-slate-300 hover:tw-border-slate-600"
                >
                  Clear
                </button>
              )}
              <label className="tw-inline-flex tw-cursor-pointer tw-items-center tw-gap-2 tw-rounded-full tw-border tw-border-slate-700 tw-bg-slate-900 tw-px-4 tw-py-2 tw-text-xs tw-font-semibold tw-uppercase tw-tracking-wide tw-text-slate-100 hover:tw-border-slate-500">
                Upload
                <input
                  key={filePickerKey}
                  type="file"
                  accept=".md,.txt,.markdown,.yaml,.yml,.json"
                  onChange={onFileChange}
                  className="tw-hidden"
                />
              </label>
            </div>
          </div>
        </div>

        <div className="tw-flex tw-flex-wrap tw-items-center tw-justify-between tw-gap-3">
          <div className="tw-text-xs tw-text-slate-400">
            Provide either pasted context or an upload. The wizard blends both sources when available.
          </div>
          <button
            type="submit"
            disabled={!canGenerate}
            className="tw-inline-flex tw-items-center tw-gap-2 tw-rounded-full tw-border tw-border-slate-800 tw-bg-slate-100 tw-px-4 tw-py-2 tw-text-sm tw-font-semibold tw-text-slate-900 tw-transition tw-duration-200 tw-ease-out disabled:tw-cursor-not-allowed disabled:tw-border-slate-800/60 disabled:tw-bg-slate-700/40 disabled:tw-text-slate-400 hover:tw-bg-white"
          >
            {isGenerating ? "Generating…" : "Generate Roadmap"}
          </button>
        </div>
      </form>

      {(error || success) && (
        <div className="tw-space-y-3">
          {error && (
            <div className="tw-rounded-2xl tw-border tw-border-red-500/40 tw-bg-red-500/10 tw-p-4 tw-text-sm tw-text-red-200">
              <p className="tw-font-semibold">{error.title}</p>
              {error.detail && <p className="tw-mt-1 tw-text-xs tw-text-red-200/80">{error.detail}</p>}
            </div>
          )}
          {success && !error && (
            <div className="tw-rounded-2xl tw-border tw-border-emerald-500/40 tw-bg-emerald-500/10 tw-p-4 tw-text-sm tw-text-emerald-200 tw-space-y-2">
              <p className="tw-font-semibold">{success.message}</p>
              {success.prUrl && (
                <a
                  href={success.prUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="tw-inline-flex tw-items-center tw-gap-2 tw-text-xs tw-font-semibold tw-text-emerald-200/90 hover:tw-text-emerald-100"
                >
                  View on GitHub
                  <span aria-hidden="true">↗</span>
                </a>
              )}
              {success.handoffPath && (
                <Link
                  href={`/wizard/roadmap/workspace?handoff=${encodeURIComponent(success.handoffPath)}`}
                  className="tw-inline-flex tw-items-center tw-gap-2 tw-rounded-full tw-border tw-border-emerald-400 tw-bg-emerald-500/20 tw-px-3 tw-py-1.5 tw-text-xs tw-font-semibold tw-uppercase tw-tracking-wide tw-text-emerald-100 hover:tw-border-emerald-300 hover:tw-text-white"
                >
                  Continue to provisioning workspace
                  <span aria-hidden="true">→</span>
                </Link>
              )}
            </div>
          )}
        </div>
      )}

      <div className="tw-grid tw-gap-6">
        <header className="tw-space-y-4">
          <div className="tw-flex tw-flex-wrap tw-items-center tw-justify-between tw-gap-3">
            <h2 className="tw-text-xl tw-font-semibold tw-text-slate-100">{targetPath}</h2>
            <span className="tw-text-xs tw-text-slate-400">Target file in repo</span>
          </div>
          <div className="tw-grid tw-gap-3 md:tw-grid-cols-2 xl:tw-grid-cols-3">
            <label className="tw-flex tw-flex-col tw-gap-1">
              <span className="tw-text-xs tw-font-semibold tw-uppercase tw-tracking-wide tw-text-slate-400">
                Linked repository
              </span>
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
              <span className="tw-text-xs tw-font-semibold tw-uppercase tw-tracking-wide tw-text-slate-400">
                Project (optional)
              </span>
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
            </label>
            {selectedRepoId === ADD_NEW_REPO_OPTION && (
              <div className="tw-grid tw-gap-3 md:tw-col-span-2 xl:tw-col-span-3 md:tw-grid-cols-2">
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
                  <span className="tw-text-xs tw-font-semibold tw-uppercase tw-tracking-wide tw-text-slate-400">
                    Repository
                  </span>
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
              <label className="tw-flex tw-flex-col tw-gap-1 md:tw-col-span-2 xl:tw-col-span-3">
                <span className="tw-text-xs tw-font-semibold tw-uppercase tw-tracking-wide tw-text-slate-400">
                  Project slug
                </span>
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
        </header>

        <div className="tw-flex tw-flex-wrap tw-items-center tw-justify-between tw-gap-3">
          <label className="tw-inline-flex tw-items-center tw-gap-2 tw-rounded-full tw-border tw-border-slate-800 tw-bg-slate-950/60 tw-px-3 tw-py-1.5 tw-text-xs tw-font-medium tw-text-slate-200">
            <input
              type="checkbox"
              checked={openAsPr}
              onChange={(event) => setOpenAsPr(event.target.checked)}
              className="tw-h-3.5 tw-w-3.5 tw-rounded tw-border tw-border-slate-700 tw-bg-slate-900 tw-text-emerald-400 focus:tw-ring-emerald-400"
            />
            <span>Open as pull request</span>
          </label>
          <button
            type="button"
            onClick={onCommit}
            disabled={!canCommit}
            className="tw-inline-flex tw-items-center tw-gap-2 tw-rounded-full tw-border tw-border-slate-800 tw-bg-emerald-400/90 tw-px-4 tw-py-2 tw-text-sm tw-font-semibold tw-text-slate-900 tw-transition tw-duration-200 tw-ease-out disabled:tw-cursor-not-allowed disabled:tw-border-slate-800/60 disabled:tw-bg-slate-700/40 disabled:tw-text-slate-400 hover:tw-bg-emerald-300"
          >
            {isCommitting ? "Committing…" : openAsPr ? "Open PR" : "Commit to Repo"}
          </button>
        </div>
        <p className="tw-text-xs tw-text-slate-400">
          {openAsPr
            ? "Creates a new branch and opens a PR with the generated roadmap."
            : `Commits ${targetPath} directly to ${branch || "main"}.`}
        </p>

        <div className="code-editor">
          <pre
            ref={previewRef}
            className="code-editor__preview"
            aria-hidden="true"
            dangerouslySetInnerHTML={{ __html: highlighted || "" }}
          />
          <textarea
            ref={editorRef}
            value={roadmap}
            onChange={(event) => setRoadmap(event.target.value)}
            spellCheck={false}
            placeholder="# Generated roadmap YAML will appear here"
            className="code-editor__textarea"
            onScroll={syncScroll}
          />
        </div>
      </div>
    </section>
  );
}

export default function ConceptWizardPage() {
  return (
    <Suspense fallback={<div className="tw-px-6 tw-py-10 tw-text-sm tw-text-slate-400">Loading concept workspace…</div>}>
      <ConceptWizardPageInner />
    </Suspense>
  );
}
