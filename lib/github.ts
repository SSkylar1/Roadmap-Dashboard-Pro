import { authHeaders, getTokenForRepo } from "@/lib/token";
import type { RepoAuth } from "@/lib/token";

async function repoAuth(owner: string, repo: string, overrideToken?: string): Promise<RepoAuth> {
  if (overrideToken) {
    return { token: overrideToken, scheme: "token", source: "pat" };
  }
  return getTokenForRepo(owner, repo);
}

function encodeGitHubPath(path: string) {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

export async function getFileRaw(owner: string, repo: string, path: string, ref?: string, token?: string) {
  const auth = await repoAuth(owner, repo, token);
  const encodedPath = encodeGitHubPath(path);
  const r = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${encodedPath}${ref ? `?ref=${ref}` : ""}`,
    {
      headers: authHeaders(auth, { Accept: "application/vnd.github.v3.raw" }),
      cache: "no-store",
    }
  );
  if (r.status === 404) return null;
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
  const auth = await repoAuth(owner, repo, token);
  const encodedPath = encodeGitHubPath(path);
  // get sha if exists
  const meta = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${encodedPath}?ref=${branch}`,
    {
      headers: authHeaders(auth, { Accept: "application/vnd.github+json" }),
    }
  );
  let sha: string | undefined;
  if (meta.ok) {
    const j = await meta.json();
    sha = j.sha;
  }

  const r = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${encodedPath}`, {
    method: "PUT",
    headers: authHeaders(auth, { "content-type": "application/json" }),
    body: JSON.stringify({
      message,
      branch,
      sha,
      content: Buffer.from(content).toString("base64"),
    }),
  });
  if (!r.ok) throw new Error(`PUT ${owner}/${repo}:${path} failed: ${r.status}`);
  return r.json();
}
