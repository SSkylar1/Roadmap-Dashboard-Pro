// lib/github.ts
export async function ghToken(): Promise<string> {
  const t = process.env.GITHUB_TOKEN;
  if (!t) throw new Error("GITHUB_TOKEN not set in environment");
  return t;
}

function ghHeaders(token?: string) {
  const h: Record<string, string> = {
    Accept: "application/vnd.github.v3.raw",
    "User-Agent": "roadmap-dashboard-pro",
  };
  if (token) {
    // Use "token <PAT>" for classic PATs (works everywhere)
    h.Authorization = `token ${token}`;
  }
  return h;
}

export async function getFileRaw(owner: string, repo: string, path: string, ref?: string, token?: string) {
  const t = token || (await ghToken());
  const url =
    `https://api.github.com/repos/${owner}/${repo}/contents/` +
    `${encodeURIComponent(path)}` +
    (ref ? `?ref=${encodeURIComponent(ref)}` : "");
  const r = await fetch(url, { headers: ghHeaders(t), cache: "no-store" });
  if (r.status === 404) return null;
  if (r.status === 401) throw new Error(`GitHub 401 (check PAT scope/access for ${owner}/${repo})`);
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
  // fetch current sha (if any)
  const metaUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${branch}`;
  const meta = await fetch(metaUrl, { headers: ghHeaders(t) });
  let sha: string | undefined;
  if (meta.ok) {
    try {
      const j = await meta.json();
      sha = j?.sha;
    } catch {}
  }

  const putUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`;
  const body = JSON.stringify({
    message,
    branch,
    sha,
    content: Buffer.from(content).toString("base64"),
  });
  const r = await fetch(putUrl, {
    method: "PUT",
    headers: {
      ...ghHeaders(t),
      Accept: "application/vnd.github+json",
      "content-type": "application/json",
    },
    body,
  });
  if (r.status === 401) throw new Error(`GitHub 401 on PUT (check PAT scope/access for ${owner}/${repo})`);
  if (!r.ok) throw new Error(`PUT ${owner}/${repo}:${path} failed: ${r.status}`);
  return r.json();
}
