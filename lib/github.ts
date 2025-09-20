import { RepoAuth, authHeaders } from "./token";

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
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}${ref ? `?ref=${ref}` : ""}`;
  const r = await fetch(url, {
    headers: authHeaders(auth, { Accept: "application/vnd.github.v3.raw" }),
    cache: "no-store",
  });
  if (!r.ok) return null;
  return await r.text();
}
