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

export async function putFile(
  owner: string,
  repo: string,
  path: string,
  content: string,
  branch: string,
  message: string,
  token?: string
) {
  const t = token || (await ghToken());
  const encodedPath = encodeGitHubPath(path);

  // 1) Fetch current sha (JSON accept!)
  const metaUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`;
  let sha: string | undefined = undefined;
  {
    const meta = await fetch(metaUrl, { headers: ghHeaders(t, "json") });
    if (meta.status === 401) throw new Error(`GitHub 401 on HEAD (check PAT scope/access for ${owner}/${repo})`);
    if (meta.status === 200) {
      const j = (await meta.json()) as { sha?: string };
      if (typeof j?.sha === "string") sha = j.sha;
    } else if (meta.status !== 404) {
      // Non-404, non-200 should surface (e.g., 403 on private repo)
      const txt = await meta.text();
      throw new Error(`HEAD ${owner}/${repo}:${path} failed: ${meta.status} ${txt}`);
    }
  }

  // 2) PUT create-or-update with sha when present
  const putUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${encodedPath}`;
  const body = JSON.stringify({
    message,
    branch,
    content: Buffer.from(content).toString("base64"),
    ...(sha ? { sha } : {}),
  });

  const r = await fetch(putUrl, {
    method: "PUT",
    headers: ghHeaders(t, "json"),
    body,
  });

  // 3) Helpful errors & a small retry on 409 (branch race)
  if (r.status === 409) {
    // optional: one light retry after re-fetching sha
    const meta2 = await fetch(metaUrl, { headers: ghHeaders(t, "json") });
    if (meta2.ok) {
      const j2 = (await meta2.json()) as { sha?: string };
      const sha2 = j2?.sha;
      if (sha2) {
        const r2 = await fetch(putUrl, {
          method: "PUT",
          headers: ghHeaders(t, "json"),
          body: JSON.stringify({
            message,
            branch,
            content: Buffer.from(content).toString("base64"),
            sha: sha2,
          }),
        });
        if (!r2.ok) throw new Error(`PUT retry ${owner}/${repo}:${path} failed: ${r2.status} ${await r2.text()}`);
        return r2.json();
      }
    }
    throw new Error(`PUT ${owner}/${repo}:${path} conflict (branch update required)`);
  }

  if (r.status === 401) throw new Error(`GitHub 401 on PUT (check PAT scope/access for ${owner}/${repo})`);
  if (r.status === 422) {
    // Typically "sha wasn't supplied" or "sha does not match"
    const txt = await r.text();
    throw new Error(`PUT ${owner}/${repo}:${path} failed 422 (likely missing/old sha): ${txt}`);
  }
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`PUT ${owner}/${repo}:${path} failed: ${r.status} ${txt}`);
  }

  return r.json();
}

export async function listRepoTree(
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

