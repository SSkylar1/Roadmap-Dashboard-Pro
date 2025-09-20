// lib/github-pr.ts
import { RepoAuth, authHeaders } from "./token";

type FileSpec = { path: string; content: string };

const H_BASE = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
};

function headersRecord(headers?: HeadersInit): Record<string, string> {
  if (!headers) return {};
  if (headers instanceof Headers) {
    return Object.fromEntries(headers.entries());
  }
  if (Array.isArray(headers)) {
    const rec: Record<string, string> = {};
    for (const [k, v] of headers) rec[k] = v;
    return rec;
  }
  return headers as Record<string, string>;
}

async function gh(url: string, auth: RepoAuth, init: RequestInit = {}) {
  const headers = authHeaders(auth, { ...H_BASE, ...headersRecord(init.headers) });
  const r = await fetch(url, { ...init, headers });
  const txt = await r.text();
  let j: any;
  try {
    j = txt ? JSON.parse(txt) : {};
  } catch {
    j = { raw: txt };
  }
  if (!r.ok)
    throw new Error(`${init.method || "GET"} ${url} -> ${r.status} ${j?.message || txt || r.statusText}`);
  return j;
}

async function ensureBranch({ owner, repo, auth, branch, base }: {
  owner: string;
  repo: string;
  auth: RepoAuth;
  branch: string;
  base: string;
}) {
  // get base SHA
  const baseRef = await gh(
    `https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(base)}`,
    auth
  );
  const baseSha: string = baseRef.object.sha;

  // create branch if missing; ignore 422 when it already exists
  try {
    await gh(`https://api.github.com/repos/${owner}/${repo}/git/refs`, auth, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: baseSha }),
    });
  } catch (e: any) {
    const msg = String(e?.message || e);
    if (!/-> 422 /.test(msg)) throw new Error(`Branch create failed: ${msg}`);
  }
}

async function upsertFile({ owner, repo, auth, branch, path, content }: {
  owner: string;
  repo: string;
  auth: RepoAuth;
  branch: string;
  path: string;
  content: string;
}) {
  const contentB64 = Buffer.from(content).toString("base64");

  // get current sha on the target branch (if file exists)
  let sha: string | undefined;
  try {
    const existing = await gh(
      `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(branch)}`,
      auth
    );
    sha = existing?.sha;
  } catch (e: any) {
    const msg = String(e?.message || e);
    if (!/-> 404 /.test(msg)) throw e; // 404 = new file, ok
  }

  const put = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`,
    {
      method: "PUT",
      headers: authHeaders(auth, { ...H_BASE, "content-type": "application/json" }),
      body: JSON.stringify({
        message: `chore: add/update ${path}`,
        content: contentB64,
        branch,
        ...(sha ? { sha } : {}),
      }),
    }
  );
  if (put.status !== 200 && put.status !== 201) {
    const txt = await put.text();
    throw new Error(`Upsert ${path} failed: ${put.status} ${txt}`);
  }
}

async function createOrReusePR({ owner, repo, auth, base, branch, title, body }: {
  owner: string;
  repo: string;
  auth: RepoAuth;
  base: string;
  branch: string;
  title: string;
  body: string;
}) {
  let pr = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls`, {
    method: "POST",
    headers: authHeaders(auth, { ...H_BASE, "content-type": "application/json" }),
    body: JSON.stringify({ title, head: branch, base, body }),
  });

  if (pr.status === 201) return pr.json();

  if (pr.status === 422) {
    const existing = await gh(
      `https://api.github.com/repos/${owner}/${repo}/pulls?state=open&head=${encodeURIComponent(owner)}:${encodeURIComponent(branch)}`,
      auth
    );
    if (Array.isArray(existing) && existing.length) return existing[0];
  }

  const txt = await pr.text();
  throw new Error(`PR failed: ${pr.status} ${txt}`);
}

export async function openSetupPR({
  owner,
  repo,
  auth,
  branch,
  files,
  title,
  body,
}: {
  owner: string;
  repo: string;
  auth: RepoAuth;
  branch: string;
  files: FileSpec[];
  title: string;
  body: string;
}) {
  // repo + default branch
  const meta = await gh(`https://api.github.com/repos/${owner}/${repo}`, auth);
  const base: string = meta.default_branch || "main";

  // ensure branch exists (no-op if already there)
  await ensureBranch({ owner, repo, auth, branch, base });

  // upsert all files on that branch
  for (const f of files) {
    await upsertFile({ owner, repo, auth, branch, path: f.path, content: f.content });
  }

  // create or reuse PR
  return await createOrReusePR({ owner, repo, auth, base, branch, title, body });
}

export async function openEditRcPR({
  owner,
  repo,
  auth,
  branch,
  newContent,
}: {
  owner: string;
  repo: string;
  auth: RepoAuth;
  branch: string;
  newContent: string;
}) {
  // repo + default branch
  const meta = await gh(`https://api.github.com/repos/${owner}/${repo}`, auth);
  const base: string = meta.default_branch || "main";

  // ensure branch exists
  await ensureBranch({ owner, repo, auth, branch, base });

  // upsert .roadmaprc.json
  await upsertFile({ owner, repo, auth, branch, path: ".roadmaprc.json", content: newContent });

  // create or reuse PR
  return await createOrReusePR({
    owner,
    repo,
    auth,
    base,
    branch,
    title: "chore(settings): update .roadmaprc.json",
    body: "Edit via dashboard settings",
  });
}
