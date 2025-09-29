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
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}${ref ? `?ref=${ref}` : ""}`;
  const r = await fetch(url, {
    headers: authHeaders(auth, RAW_ACCEPT_HEADER),
    cache: "no-store",
  });
  if (!r.ok) return null;
  return await r.text();
}

export async function getFileRaw({
  owner,
  repo,
  path,
  ref,
}: {
  owner: string;
  repo: string;
  path: string;
  ref?: string;
}) {
  const auth = await getTokenForRepo(owner, repo);
  return fetchRepoFile({ owner, repo, path, ref, auth });
}
