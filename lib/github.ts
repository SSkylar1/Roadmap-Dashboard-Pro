export async function ghToken(): Promise<string> {
  // For MVP use a repo-level PAT via Vercel env GITHUB_TOKEN (repo: contents write)
  const t = process.env.GITHUB_TOKEN;
  if (!t) throw new Error("GITHUB_TOKEN not set. Add it in Vercel → Project → Settings → Environment Variables.");
  return t;
}

export async function getFileRaw(owner: string, repo: string, path: string, ref?: string, token?: string) {
  const t = token || await ghToken();
  const r = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}${ref ? `?ref=${ref}` : ""}`, {
    headers: { Authorization: `Bearer ${t}`, Accept: "application/vnd.github.v3.raw" },
    cache: "no-store",
  });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GET ${owner}/${repo}:${path} failed: ${r.status}`);
  return r.text();
}

export async function putFile(owner: string, repo: string, path: string, content: string, branch: string, message: string, token?: string) {
  const t = token || await ghToken();
  // get sha if exists
  const meta = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${branch}`, {
    headers: { Authorization: `Bearer ${t}`, Accept: "application/vnd.github+json" },
  });
  let sha: string | undefined;
  if (meta.ok) { const j = await meta.json(); sha = j.sha; }

  const r = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${t}`, "content-type": "application/json" },
    body: JSON.stringify({
      message, branch, sha,
      content: Buffer.from(content).toString("base64"),
    }),
  });
  if (!r.ok) throw new Error(`PUT ${owner}/${repo}:${path} failed: ${r.status}`);
  return r.json();
}
