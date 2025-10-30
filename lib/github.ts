// lib/github.ts
export async function ghToken(): Promise<string>;
export async function ghToken(required: false): Promise<string | undefined>;
export async function ghToken(required = true): Promise<string | undefined> {
  const t = process.env.GITHUB_TOKEN;
  if (!t) {
    if (required) throw new Error("GITHUB_TOKEN not set in environment");
    return undefined;
  }
  return t;
}

// Accept mode: "raw" for file bytes, "json" for API metadata bodies
function ghHeaders(token?: string, mode: "raw" | "json" = "json") {
  const h: Record<string, string> = {
    "User-Agent": "roadmap-dashboard-pro",
    Accept: mode === "raw" ? "application/vnd.github.v3.raw" : "application/vnd.github+json",
  };
  if (token) h.Authorization = `token ${token}`;
  return h;
}

export function encodeGitHubPath(path: string) {
  return path
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

export async function getFileRaw(owner: string, repo: string, path: string, ref?: string, token?: string) {
  const t = token ?? (await ghToken(false));
  const encodedPath = encodeGitHubPath(path);
  const url =
    `https://api.github.com/repos/${owner}/${repo}/contents/` +
    `${encodedPath}` +
    (ref ? `?ref=${encodeURIComponent(ref)}` : "");
  const r = await fetch(url, { headers: ghHeaders(t, "raw"), cache: "no-store" });
  if (r.status === 404) return null;
  if (r.status === 401) {
    if (!t) throw new Error(`GitHub 401 (set GITHUB_TOKEN with access to ${owner}/${repo})`);
    throw new Error(`GitHub 401 (check PAT scope/access for ${owner}/${repo})`);
  }
  if (!r.ok) throw new Error(`GET ${owner}/${repo}:${path} failed: ${r.status}`);
  return r.text();
}

export interface PutFileOptions {
  token?: string;
  asPR?: boolean;
  prTitle?: string;
  prBody?: string;
  headBranch?: string;
}

export interface PutFileResult {
  branch: string;
  pullRequest?: {
    number?: number;
    url?: string;
    html_url?: string;
  };
  [key: string]: unknown;
}

function encodeGitRef(ref: string) {
  return ref
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function generateRoadmapBranch(baseBranch: string) {
  const sanitizedBase = baseBranch
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  const suffix = Date.now().toString(36);
  return `${sanitizedBase ? `${sanitizedBase}-` : ""}roadmap-${suffix}`;
}

async function commitToBranch(
  owner: string,
  repo: string,
  path: string,
  content: string,
  branch: string,
  message: string,
  token: string,
): Promise<Record<string, unknown>> {
  const encodedPath = encodeGitHubPath(path);
  const metaUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`;
  let sha: string | undefined = undefined;
  {
    const meta = await fetch(metaUrl, { headers: ghHeaders(token, "json") });
    if (meta.status === 401) throw new Error(`GitHub 401 on HEAD (check PAT scope/access for ${owner}/${repo})`);
    if (meta.status === 200) {
      const j = (await meta.json()) as { sha?: string };
      if (typeof j?.sha === "string") sha = j.sha;
    } else if (meta.status !== 404) {
      const txt = await meta.text();
      throw new Error(`HEAD ${owner}/${repo}:${path} failed: ${meta.status} ${txt}`);
    }
  }

  const putUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${encodedPath}`;
  const body = JSON.stringify({
    message,
    branch,
    content: Buffer.from(content).toString("base64"),
    ...(sha ? { sha } : {}),
  });

  const r = await fetch(putUrl, {
    method: "PUT",
    headers: ghHeaders(token, "json"),
    body,
  });

  if (r.status === 409) {
    const meta2 = await fetch(metaUrl, { headers: ghHeaders(token, "json") });
    if (meta2.ok) {
      const j2 = (await meta2.json()) as { sha?: string };
      const sha2 = j2?.sha;
      if (sha2) {
        const r2 = await fetch(putUrl, {
          method: "PUT",
          headers: ghHeaders(token, "json"),
          body: JSON.stringify({
            message,
            branch,
            content: Buffer.from(content).toString("base64"),
            sha: sha2,
          }),
        });
        if (!r2.ok) throw new Error(`PUT retry ${owner}/${repo}:${path} failed: ${r2.status} ${await r2.text()}`);
        return r2.json() as Promise<Record<string, unknown>>;
      }
    }
    throw new Error(`PUT ${owner}/${repo}:${path} conflict (branch update required)`);
  }

  if (r.status === 401) throw new Error(`GitHub 401 on PUT (check PAT scope/access for ${owner}/${repo})`);
  if (r.status === 422) {
    const txt = await r.text();
    throw new Error(`PUT ${owner}/${repo}:${path} failed 422 (likely missing/old sha): ${txt}`);
  }
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`PUT ${owner}/${repo}:${path} failed: ${r.status} ${txt}`);
  }

  return r.json() as Promise<Record<string, unknown>>;
}

async function createPullRequest(
  owner: string,
  repo: string,
  headBranch: string,
  baseBranch: string,
  message: string,
  token: string,
  body?: string,
) {
  const prUrl = `https://api.github.com/repos/${owner}/${repo}/pulls`;
  const prResponse = await fetch(prUrl, {
    method: "POST",
    headers: ghHeaders(token, "json"),
    body: JSON.stringify({
      title: message,
      head: headBranch,
      base: baseBranch,
      body: body ?? "",
    }),
  });

  if (!prResponse.ok) {
    const txt = await prResponse.text();
    throw new Error(`Failed to open pull request (${prResponse.status}): ${txt}`);
  }

  return (await prResponse.json()) as { number?: number; url?: string; html_url?: string };
}

export async function putFile(
  owner: string,
  repo: string,
  path: string,
  content: string,
  branch: string,
  message: string,
  tokenOrOptions?: string | PutFileOptions,
  maybeOptions?: PutFileOptions,
): Promise<PutFileResult> {
  let options: PutFileOptions = {};
  if (typeof tokenOrOptions === "string" || typeof tokenOrOptions === "undefined") {
    options = { ...(maybeOptions ?? {}), token: tokenOrOptions };
  } else if (tokenOrOptions) {
    options = { ...tokenOrOptions };
  }

  const t = options.token ?? (await ghToken());
  const asPR = Boolean(options.asPR);

  if (!asPR) {
    const result = await commitToBranch(owner, repo, path, content, branch, message, t);
    return { ...result, branch };
  }

  const baseBranch = branch || "main";
  const headBranch = options.headBranch?.trim() || generateRoadmapBranch(baseBranch);

  const refUrl = `https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${encodeGitRef(baseBranch)}`;
  const baseRefResponse = await fetch(refUrl, { headers: ghHeaders(t, "json") });
  if (baseRefResponse.status === 404) {
    throw new Error(`Base branch ${baseBranch} not found in ${owner}/${repo}`);
  }
  if (!baseRefResponse.ok) {
    const txt = await baseRefResponse.text();
    throw new Error(`Failed to load base branch ${baseBranch}: ${baseRefResponse.status} ${txt}`);
  }

  const baseRef = (await baseRefResponse.json()) as { object?: { sha?: string } };
  const baseSha = baseRef?.object?.sha;
  if (!baseSha) {
    throw new Error(`Unable to resolve sha for ${owner}/${repo}@${baseBranch}`);
  }

  let branchToUse = headBranch;
  const createRefUrl = `https://api.github.com/repos/${owner}/${repo}/git/refs`;

  async function tryCreateRef(targetBranch: string, allowRetry: boolean): Promise<string> {
    const createResponse = await fetch(createRefUrl, {
      method: "POST",
      headers: ghHeaders(t, "json"),
      body: JSON.stringify({ ref: `refs/heads/${targetBranch}`, sha: baseSha }),
    });

    if (createResponse.ok) {
      return targetBranch;
    }

    if (createResponse.status === 422 && allowRetry) {
      const fallback = `${targetBranch}-${Math.random().toString(36).slice(2, 8)}`;
      return tryCreateRef(fallback, false);
    }

    const txt = await createResponse.text();
    throw new Error(`Failed to create branch ${targetBranch}: ${createResponse.status} ${txt}`);
  }

  branchToUse = await tryCreateRef(branchToUse, !options.headBranch);

  const commitResult = await commitToBranch(owner, repo, path, content, branchToUse, message, t);
  const prTitle = options.prTitle?.trim() || message;
  const prBody = options.prBody;
  const pullRequest = await createPullRequest(owner, repo, branchToUse, baseBranch, prTitle, t, prBody);

  return { ...commitResult, branch: branchToUse, pullRequest };
}

export async function listRepoTreePaths(
  owner: string,
  repo: string,
  ref = "HEAD",
  token?: string
) {
  const t = token ?? (await ghToken(false));
  const url =
    `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}` +
    "?recursive=1";
  const r = await fetch(url, { headers: ghHeaders(t, "json"), cache: "no-store" });
  if (r.status === 404) return [] as string[];
  if (r.status === 401) {
    if (!t) throw new Error(`GitHub 401 (set GITHUB_TOKEN with access to ${owner}/${repo})`);
    throw new Error(`GitHub 401 (check PAT scope/access for ${owner}/${repo})`);
  }
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`GET tree ${owner}/${repo}@${ref} failed: ${r.status} ${txt}`);
  }

  const json = (await r.json()) as { tree?: Array<{ type?: string; path?: string }> };
  if (!json?.tree) return [] as string[];
  return json.tree
    .filter((node) => node?.type === "blob" && typeof node?.path === "string")
    .map((node) => node.path!)
    .sort();
}

export const listRepoTree = listRepoTreePaths;

export interface DeletePathOptions {
  token?: string;
  branch?: string;
  message?: string | ((path: string) => string);
}

export interface DeletePathResult {
  deleted: string[];
  missing: string[];
}

function resolveDeleteMessage(path: string, message?: string | ((path: string) => string)): string {
  if (typeof message === "function") {
    const resolved = message(path);
    if (typeof resolved === "string" && resolved.trim()) {
      return resolved.trim();
    }
  } else if (typeof message === "string" && message.trim()) {
    return message.trim();
  }
  return `chore: remove ${path}`;
}

export async function deletePath(
  owner: string,
  repo: string,
  targetPath: string,
  options: DeletePathOptions = {},
): Promise<DeletePathResult> {
  const branch = options.branch?.trim();
  const t = options.token ?? (await ghToken());
  const deleted = new Set<string>();
  const missing = new Set<string>();
  const visited = new Set<string>();

  async function remove(path: string): Promise<void> {
    const normalized = path.replace(/^\/+/, "").replace(/\/+/g, "/");
    if (!normalized || visited.has(normalized)) return;
    visited.add(normalized);

    const encodedPath = encodeGitHubPath(normalized);
    const metaUrl =
      `https://api.github.com/repos/${owner}/${repo}/contents/${encodedPath}` +
      (branch ? `?ref=${encodeURIComponent(branch)}` : "");
    const metaResponse = await fetch(metaUrl, { headers: ghHeaders(t, "json"), cache: "no-store" });

    if (metaResponse.status === 404) {
      missing.add(normalized);
      return;
    }

    if (metaResponse.status === 401) {
      throw new Error(`GitHub 401 deleting ${owner}/${repo}:${normalized}`);
    }

    if (!metaResponse.ok) {
      const txt = await metaResponse.text();
      throw new Error(`HEAD ${owner}/${repo}:${normalized} failed: ${metaResponse.status} ${txt}`);
    }

    const metaBody = await metaResponse.json();

    if (Array.isArray(metaBody)) {
      const entries = metaBody
        .filter((entry) => entry && typeof entry.path === "string")
        .map((entry) => entry as { path: string; type?: string })
        .sort((a, b) => {
          if (a.type === b.type) return a.path.localeCompare(b.path);
          if (a.type === "dir") return -1;
          if (b.type === "dir") return 1;
          return a.path.localeCompare(b.path);
        });
      if (entries.length === 0) {
        missing.add(normalized);
        return;
      }
      for (const entry of entries) {
        await remove(entry.path);
      }
      return;
    }

    if (metaBody && metaBody.type === "dir" && typeof metaBody.path === "string") {
      const entriesUrl =
        `https://api.github.com/repos/${owner}/${repo}/contents/${encodeGitHubPath(metaBody.path)}` +
        (branch ? `?ref=${encodeURIComponent(branch)}` : "");
      const entriesResponse = await fetch(entriesUrl, { headers: ghHeaders(t, "json"), cache: "no-store" });
      if (entriesResponse.status === 404) {
        missing.add(metaBody.path);
        return;
      }
      if (!entriesResponse.ok) {
        const txt = await entriesResponse.text();
        throw new Error(`HEAD ${owner}/${repo}:${metaBody.path} failed: ${entriesResponse.status} ${txt}`);
      }
      const entries = (await entriesResponse.json()) as Array<{ path?: string }>;
      if (!Array.isArray(entries) || entries.length === 0) {
        missing.add(metaBody.path);
        return;
      }
      for (const entry of entries) {
        if (typeof entry?.path === "string") {
          await remove(entry.path);
        }
      }
      return;
    }

    const sha = typeof metaBody?.sha === "string" ? (metaBody.sha as string) : null;
    const remotePath = typeof metaBody?.path === "string" ? (metaBody.path as string) : normalized;
    if (!sha) {
      throw new Error(`Missing sha for ${owner}/${repo}:${remotePath}`);
    }

    const deleteUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeGitHubPath(remotePath)}`;
    const body: Record<string, string> = { message: resolveDeleteMessage(remotePath, options.message), sha };
    if (branch) body.branch = branch;

    const deleteResponse = await fetch(deleteUrl, {
      method: "DELETE",
      headers: ghHeaders(t, "json"),
      body: JSON.stringify(body),
    });

    if (deleteResponse.status === 404) {
      missing.add(remotePath);
      return;
    }

    if (deleteResponse.status === 401) {
      throw new Error(`GitHub 401 deleting ${owner}/${repo}:${remotePath}`);
    }

    if (!deleteResponse.ok) {
      const txt = await deleteResponse.text();
      throw new Error(`DELETE ${owner}/${repo}:${remotePath} failed: ${deleteResponse.status} ${txt}`);
    }

    deleted.add(remotePath);
  }

  await remove(targetPath);

  return { deleted: Array.from(deleted), missing: Array.from(missing) };
}

