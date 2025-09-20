import { RepoAuth, authHeaders } from "./token";

const API_HEADERS = { Accept: "application/vnd.github+json" };

export async function ensureBranch(opts: {
  owner: string;
  repo: string;
  branch: string;
  auth: RepoAuth;
}) {
  const { owner, repo, branch, auth } = opts;
  const headers = authHeaders(auth, API_HEADERS);

  // already exists?
  const ref = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${branch}`,
    { headers }
  );
  if (ref.status === 200) return;

  // create from default branch tip
  const repoInfo = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers });
  if (!repoInfo.ok) throw new Error(`Repo info failed: ${repoInfo.status}`);
  const r = await repoInfo.json();
  const def = r.default_branch as string;

  const baseRef = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${def}`,
    { headers }
  );
  if (!baseRef.ok) throw new Error(`Default ref failed: ${baseRef.status}`);
  const base = await baseRef.json();

  const created = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/refs`,
    {
      method: "POST",
      headers: authHeaders(auth, { ...API_HEADERS, "content-type": "application/json" }),
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: base.object.sha }),
    }
  );
  if (!created.ok && created.status !== 422) {
    throw new Error(`Create branch failed: ${created.status} ${await created.text()}`);
  }
}

export async function upsertFile(opts: {
  owner: string;
  repo: string;
  path: string;
  branch: string;
  auth: RepoAuth;
  json: unknown;
  createMessage?: string;
  updateMessage?: string;
}) {
  const {
    owner,
    repo,
    path,
    branch,
    auth,
    json,
    createMessage = `chore: add ${path}`,
    updateMessage = `chore: update ${path}`,
  } = opts;

  const baseHeaders = authHeaders(auth, API_HEADERS);

  await ensureBranch({ owner, repo, branch, auth });

  // does file exist? (to fetch sha)
  const head = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(
      path
    )}?ref=${encodeURIComponent(branch)}`,
    { headers: baseHeaders }
  );

  let sha: string | undefined;
  if (head.status === 200) {
    const j = await head.json();
    sha = j.sha;
  } else if (head.status !== 404) {
    throw new Error(`Check ${path} failed: ${head.status} ${await head.text()}`);
  }

  const contentB64 = Buffer.from(
    JSON.stringify(json, null, 2),
    "utf8"
  ).toString("base64");

  const put = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(
      path
    )}`,
    {
      method: "PUT",
      headers: authHeaders(auth, { ...API_HEADERS, "content-type": "application/json" }),
      body: JSON.stringify({
        message: sha ? updateMessage : createMessage,
        content: contentB64,
        branch,
        ...(sha ? { sha } : {}),
      }),
    }
  );
  if (!put.ok) {
    throw new Error(`Upsert ${path} failed: ${put.status} ${await put.text()}`);
  }
}
