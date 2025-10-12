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
import yaml from "js-yaml";

import { describeProjectFile, normalizeProjectKey } from "@/lib/project-paths";
import { mergeProjectOptions } from "@/lib/project-options";
import { removeProjectFromStore, removeRepoFromStore } from "@/lib/secrets-actions";
import { CONCEPT_HANDOFF_KEY, ROADMAP_HANDOFF_KEY } from "@/lib/wizard-handoff";
import { useLocalSecrets, useResolvedSecrets } from "@/lib/use-local-secrets";

type ErrorState = { title: string; detail?: string } | null;
type SuccessState = {
  message: string;
  prUrl?: string;
  handoffPath?: string;
  promotedBranch?: string;
} | null;

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

function normalizeRoadmapContent(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) {
    return "";
  }

  const fenceMatch =
    trimmed.match(/```(?:yaml|yml)?\s*\n([\s\S]*?)```/i) ??
    trimmed.match(/~~~(?:yaml|yml)?\s*\n([\s\S]*?)~~~/i);

  const initialCandidate = (fenceMatch ? fenceMatch[1] : trimmed).trim();
  if (!initialCandidate) {
    return "";
  }

  const lines = initialCandidate.split(/\r?\n/);
  const attempted = new Set<string>();

  const tryCandidate = (value: string) => {
    const next = value.trim();
    if (!next || attempted.has(next)) {
      return null;
    }
    attempted.add(next);
    try {
      yaml.load(next);
      return next;
    } catch (err) {
      return null;
    }
  };

  const direct = tryCandidate(initialCandidate);
  if (direct) {
    return direct;
  }

  for (let start = 0; start < lines.length; start += 1) {
    for (let end = lines.length; end > start; end -= 1) {
      const subset = tryCandidate(lines.slice(start, end).join("\n"));
      if (subset) {
        return subset;
      }
    }
  }

  return initialCandidate;
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
  const [promotedBranch, setPromotedBranch] = useState<string | null>(null);
  const previewRef = useRef<HTMLPreElement | null>(null);
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const secretsStore = useLocalSecrets();
  const secrets = useResolvedSecrets(owner, repo, project || undefined);
  const openAiConfigured = Boolean(secrets.openaiKey);
  const githubConfigured = Boolean(secrets.githubPat);
  const repoEntries = secretsStore.repos;
  const [selectedRepoId, setSelectedRepoId] = useState<string>(ADD_NEW_REPO_OPTION);
  const [selectedProjectOption, setSelectedProjectOption] = useState<string>("");
  const [discoveredProjectSlugs, setDiscoveredProjectSlugs] = useState<string[]>([]);
  const [projectSlugsLoading, setProjectSlugsLoading] = useState(false);
  const [projectSlugsError, setProjectSlugsError] = useState<string | null>(null);
  const [initialContextApplied, setInitialContextApplied] = useState(false);
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

  const combinedPrompt = useMemo(() => {
    if (conceptText && uploadText) {
      return `${conceptText.trim()}\n\nUploaded context:\n${uploadText.trim()}`;
    }
    if (conceptText) return conceptText.trim();
    if (uploadText) return uploadText.trim();
    return "";
  }, [conceptText, uploadText]);

  const normalizedRoadmap = useMemo(() => normalizeRoadmapContent(roadmap), [roadmap]);
  const highlighted = useMemo(() => highlightYaml(roadmap || ""), [roadmap]);

  const projectKey = normalizeProjectKey(project);

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
        const preferredBranch = hint.promotedBranch?.trim() || hint.branch?.trim();
        if (preferredBranch && (!branch || branch === "main")) {
          setBranch(preferredBranch);
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
          const nextPromoted = hydrated?.promotedBranch?.trim() ?? null;
          setPromotedBranch((current) => (current === nextPromoted ? current : nextPromoted));
          applyContext(hydrated);
        } else {
          setHandoffHint({ path: handoffParam });
          setPromotedBranch((current) => (current === null ? current : null));
        }
      } else if (stored?.path) {
        const hydrated = hydrateHint(stored);
        setHandoffHint(hydrated);
        const nextPromoted = hydrated?.promotedBranch?.trim() ?? null;
        setPromotedBranch((current) => (current === nextPromoted ? current : nextPromoted));
        applyContext(hydrated);
      } else {
        setHandoffHint(null);
        setPromotedBranch((current) => (current === null ? current : null));
      }
    } catch (err) {
      console.error("Failed to read concept handoff", err);
      if (handoffParam) {
        setHandoffHint({ path: handoffParam });
      }
      setPromotedBranch((current) => (current === null ? current : null));
    }
  }, [handoffParam, branch, owner, project, repo, initialContextApplied]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (normalizedRoadmap !== roadmap) {
      setRoadmap(normalizedRoadmap);
      return;
    }

    if (!normalizedRoadmap) {
      window.localStorage.removeItem(ROADMAP_HANDOFF_KEY);
      return;
    }

    const label = describeProjectFile("docs/roadmap.yml", projectKey);
    const trimmedOwner = owner.trim();
    const trimmedRepo = repo.trim();
    const trimmedBranch = branch.trim();
    const trimmedPromoted = promotedBranch?.trim() ?? null;

    const payload = {
      path: label,
      label,
      content: normalizedRoadmap,
      ...(trimmedOwner ? { owner: trimmedOwner } : {}),
      ...(trimmedRepo ? { repo: trimmedRepo } : {}),
      ...(trimmedBranch ? { branch: trimmedBranch } : {}),
      project: projectKey ?? null,
      ...(trimmedPromoted ? { promotedBranch: trimmedPromoted } : {}),
      createdAt: Date.now(),
    } satisfies HandoffHint & { createdAt: number };

    try {
      window.localStorage.setItem(ROADMAP_HANDOFF_KEY, JSON.stringify(payload));
    } catch (err) {
      console.error("Failed to persist roadmap handoff", err);
    }
  }, [roadmap, normalizedRoadmap, projectKey, owner, repo, branch, promotedBranch]);

  const canGenerate = Boolean(!isGenerating && combinedPrompt);
  const targetPath = describeProjectFile("docs/roadmap.yml", projectKey);
  const canCommit = Boolean(!isCommitting && normalizedRoadmap && owner && repo && branch);
  const roadmapLinkHref = useMemo(() => {
    if (!success?.handoffPath) {
      return null;
    }

    const params = new URLSearchParams();
    params.set("handoff", success.handoffPath);

    const trimmedOwner = owner.trim();
    if (trimmedOwner) {
      params.set("owner", trimmedOwner);
    }

    const trimmedRepo = repo.trim();
    if (trimmedRepo) {
      params.set("repo", trimmedRepo);
    }

    const branchSource = success.promotedBranch ?? promotedBranch ?? branch;
    const trimmedBranch = branchSource ? branchSource.trim() : "";
    if (trimmedBranch) {
      params.set("branch", trimmedBranch);
    }

    if (projectKey) {
      params.set("project", projectKey);
    }

    return `/wizard/roadmap/workspace?${params.toString()}`;
  }, [success, owner, repo, branch, promotedBranch, projectKey]);

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
      const normalized = normalizeRoadmapContent(data.roadmap);
      setRoadmap(normalized);
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
        const fetchOwner = handoffHint.owner || owner;
        const fetchRepo = handoffHint.repo || repo;
        if (!fetchOwner || !fetchRepo) {
          setHandoffError("Provide owner and repo before importing the shared file.");
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
          const title = typeof payload?.error === "string" ? payload.error : "Failed to import shared file";
          setHandoffError(title);
          return;
        }

        content = typeof payload.content === "string" ? payload.content : "";
        const payloadLabel = typeof payload.label === "string" ? payload.label : undefined;
        name = payloadLabel ?? (typeof payload.name === "string" ? payload.name : name);
        sizeLabel = typeof payload.sizeLabel === "string" ? payload.sizeLabel : sizeLabel;
        const normalizedPath = typeof payload.path === "string" ? payload.path : handoffHint.path;
        const baseBranch = handoffHint.branch || branch || "main";
        const projectForHint = (handoffHint.project ?? fetchProject) || null;
        const updatedHint: HandoffHint = {
          ...handoffHint,
          path: normalizedPath,
          label: payloadLabel ?? name,
          content,
          owner: fetchOwner,
          repo: fetchRepo,
          branch: baseBranch,
          promotedBranch: fetchBranch,
          project: projectForHint,
        };
        setHandoffHint(updatedHint);
        const nextPromoted = updatedHint.promotedBranch?.trim() ?? null;
        setPromotedBranch((current) => (current === nextPromoted ? current : nextPromoted));
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
    const normalized = normalizeRoadmapContent(roadmap);
    if (!normalized) {
      setError({ title: "Roadmap is empty", detail: "Generate or paste roadmap content before committing." });
      return;
    }
    if (!owner || !repo) {
      setError({ title: "Connect a repo", detail: "Provide owner and repo so the wizard can push docs/roadmap.yml." });
      return;
    }

    if (normalized !== roadmap) {
      setRoadmap(normalized);
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
        body: JSON.stringify({
          owner,
          repo,
          branch: branch || "main",
          content: normalized,
          project: project || undefined,
        }),
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
        const fallbackBranch = branch.trim() || "main";
        const resolvedBranch =
          (typeof detail.branch === "string" && detail.branch.trim()) || fallbackBranch;
        setPromotedBranch(resolvedBranch);
        if (openAsPr) {
          if (detail.prUrl) {
            const label = detail.pullRequestNumber ? `PR #${detail.pullRequestNumber}` : "Pull request";
            setSuccess({
              message: `${label} opened for ${committedPath}.`,
              prUrl: detail.prUrl,
              handoffPath: committedPath,
              promotedBranch: resolvedBranch,
            });
          } else {
            setSuccess({
              message: `Pull request opened for ${committedPath}. Check GitHub to review and merge.`,
              handoffPath: committedPath,
              promotedBranch: resolvedBranch,
            });
          }
        } else {
          setSuccess({
            message: `${committedPath} committed to ${resolvedBranch}.`,
            handoffPath: committedPath,
            promotedBranch: resolvedBranch,
          });
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
              {roadmapLinkHref && (
                <Link
                  href={roadmapLinkHref}
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
