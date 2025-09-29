 import { RepoAuth, authHeaders, getTokenForRepo } from "./token";

const RAW_ACCEPT_HEADER = { Accept: "application/vnd.github.v3.raw" } as const;

export async function fetchRepoFile({
  owner,
  repo,
  path,
  ref,
  auth,
}: {
  owner: string;
  repo: string;
  path: string;
  ref?: string;
  auth: RepoAuth;
}) {
  const encodedPath = path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodedPath}${
    ref ? `?ref=${encodeURIComponent(ref)}` : ""
  }`;
  const r = await fetch(url, {
    headers: authHeaders(auth, RAW_ACCEPT_HEADER),
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

export async function getFileRaw({
  owner,
  repo,
  path,
  ref,
  auth,
}: {
  owner: string;
  repo: string;
  path: string;
  ref?: string;
  auth?: RepoAuth;
}) {
  let repoAuth = auth;
  if (!repoAuth) {
    try {
      repoAuth = await getTokenForRepo(owner, repo);
    } catch (error: any) {
      const message = error?.message ? String(error.message) : "";
      const missingCreds = message.includes("No GitHub credentials configured");
      if (!missingCreds) throw error;
    }
  }

  if (repoAuth) {
    const viaApi = await fetchRepoFile({ owner, repo, path, ref, auth: repoAuth });
    if (viaApi !== null) return viaApi;
  }

  const branch = ref ?? "main";
  const encodedPath = path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const url = `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(branch)}/${encodedPath}`;
  const r = await fetch(url, { headers: RAW_ACCEPT_HEADER, cache: "no-store" });
  if (!r.ok) return null;
  return await r.text();
}
