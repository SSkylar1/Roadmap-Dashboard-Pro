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

import { useLocalSecrets } from "@/lib/use-local-secrets";

type ErrorState = { title: string; detail?: string } | null;
type SuccessState = { message: string; prUrl?: string } | null;

type GenerateResponse = { roadmap: string };

type CommitResponse = {
  ok: boolean;
  branch?: string;
  prUrl?: string;
  pullRequestNumber?: number;
  error?: string;
  detail?: string;
};

type UploadState = {
  name: string;
  sizeLabel: string;
};

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
  const [owner, setOwner] = useState(() => params.get("owner") ?? "");
  const [repo, setRepo] = useState(() => params.get("repo") ?? "");
  const [branch, setBranch] = useState(() => params.get("branch") ?? "main");
  const [conceptText, setConceptText] = useState("");
  const [upload, setUpload] = useState<UploadState | null>(null);
  const [uploadText, setUploadText] = useState("");
  const [filePickerKey, setFilePickerKey] = useState(0);
  const [isGenerating, setIsGenerating] = useState(false);
  const [roadmap, setRoadmap] = useState("");
  const [error, setError] = useState<ErrorState>(null);
  const [success, setSuccess] = useState<SuccessState>(null);
  const [openAsPr, setOpenAsPr] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);
  const previewRef = useRef<HTMLPreElement | null>(null);
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const secrets = useLocalSecrets();
  const openAiConfigured = Boolean(secrets.openaiKey);
  const githubConfigured = Boolean(secrets.githubPat);

  const combinedPrompt = useMemo(() => {
    if (conceptText && uploadText) {
      return `${conceptText.trim()}\n\nUploaded context:\n${uploadText.trim()}`;
    }
    if (conceptText) return conceptText.trim();
    if (uploadText) return uploadText.trim();
    return "";
  }, [conceptText, uploadText]);

  const highlighted = useMemo(() => highlightYaml(roadmap || ""), [roadmap]);

  useEffect(() => {
    if (previewRef.current && editorRef.current) {
      previewRef.current.scrollTop = editorRef.current.scrollTop;
      previewRef.current.scrollLeft = editorRef.current.scrollLeft;
    }
  }, [roadmap]);

  const canGenerate = Boolean(!isGenerating && combinedPrompt);
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
        body: JSON.stringify({ owner, repo, branch: branch || "main", content: roadmap }),
      });

      const detail = (await response.json().catch(() => ({}))) as CommitResponse;

      if (!response.ok) {
        const title = typeof detail?.error === "string" ? detail.error : "Commit failed";
        const info = typeof detail?.detail === "string" ? detail.detail : undefined;
        setError({ title, detail: info });
        return;
      }

      if (detail.ok) {
        if (openAsPr) {
          if (detail.prUrl) {
            const label = detail.pullRequestNumber ? `PR #${detail.pullRequestNumber}` : "Pull request";
            setSuccess({
              message: `${label} opened for docs/roadmap.yml.`,
              prUrl: detail.prUrl,
            });
          } else {
            setSuccess({
              message: "Pull request opened for docs/roadmap.yml. Check GitHub to review and merge.",
            });
          }
        } else {
          const targetBranch = detail.branch ?? branch;
          setSuccess({ message: `docs/roadmap.yml committed to ${targetBranch}.` });
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
            </div>
          )}
        </div>
      )}

      <div className="tw-grid tw-gap-4">
        <div className="tw-flex tw-flex-wrap tw-items-center tw-justify-between tw-gap-3">
          <h2 className="tw-text-xl tw-font-semibold tw-text-slate-100">docs/roadmap.yml</h2>
        <div className="tw-flex tw-flex-wrap tw-items-center tw-gap-2">
          <input
            value={owner}
            onChange={(event) => setOwner(event.target.value)}
            placeholder="owner"
              className="tw-w-32 tw-rounded-full tw-border tw-border-slate-800 tw-bg-slate-950/70 tw-px-3 tw-py-1.5 tw-text-xs tw-text-slate-100 focus:tw-border-slate-600"
            />
            <span className="tw-text-slate-400">/</span>
            <input
              value={repo}
              onChange={(event) => setRepo(event.target.value)}
              placeholder="repo"
              className="tw-w-40 tw-rounded-full tw-border tw-border-slate-800 tw-bg-slate-950/70 tw-px-3 tw-py-1.5 tw-text-xs tw-text-slate-100 focus:tw-border-slate-600"
            />
            <input
              value={branch}
              onChange={(event) => setBranch(event.target.value)}
              placeholder="branch"
            className="tw-w-32 tw-rounded-full tw-border tw-border-slate-800 tw-bg-slate-950/70 tw-px-3 tw-py-1.5 tw-text-xs tw-text-slate-100 focus:tw-border-slate-600"
          />
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
            {isCommitting ? "Committing…" : "Commit to Repo"}
          </button>
        </div>
      </div>
      <p className="tw-text-xs tw-text-slate-400">
          {openAsPr
            ? "Creates a new branch and opens a PR with the generated roadmap."
            : `Commits docs/roadmap.yml directly to ${branch || "main"}.`}
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
