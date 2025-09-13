export async function fetchRepoFile({
  owner, repo, path, ref, token
}: { owner: string; repo: string; path: string; ref?: string; token: string }) {
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}${ref ? `?ref=${ref}` : ""}`;
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github.v3.raw" },
    cache: "no-store"
  });
  if (!r.ok) return null;
  return await r.text();
}
