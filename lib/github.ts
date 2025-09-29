import { RepoAuth, authHeaders, getTokenForRepo } from "./token";

const USER_AGENT = "roadmap-dashboard-pro";
const RAW_ACCEPT_HEADER: Record<string, string> = { Accept: "application/vnd.github.v3.raw" };
const API_HEADERS: Record<string, string> = {
  ...RAW_ACCEPT_HEADER,
  "User-Agent": USER_AGENT,
  "X-GitHub-Api-Version": "2022-11-28",
};
const RAW_HEADERS: Record<string, string> = {
  ...RAW_ACCEPT_HEADER,
  "User-Agent": USER_AGENT,
};

export function encodeRepoPath(path: string): string {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

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
  const encodedPath = encodeRepoPath(path);
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodedPath}${
    ref ? `?ref=${encodeURIComponent(ref)}` : ""
  }`;
  const r = await fetch(url, {
    headers: authHeaders(auth, API_HEADERS),
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
  const encodedPath = encodeRepoPath(path);
  const url = `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(branch)}/${encodedPath}`;
  const r = await fetch(url, { headers: RAW_HEADERS, cache: "no-store" });
  if (!r.ok) return null;
  return await r.text();
}
