export async function openSetupPR({ owner, repo, token, branch, files, title, body }: {
  owner: string; repo: string; token: string; branch: string;
  files: { path: string; content: string }[]; title: string; body: string;
}) {
  let res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Repo fetch failed: ${res.status}`);
  const meta = await res.json();
  const base = meta.default_branch || "main";
  res = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${base}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Ref fetch failed: ${res.status}`);
  const ref = await res.json();
  res = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/refs`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: ref.object.sha })
  });
  if (res.status !== 201) throw new Error(`Branch create failed: ${res.status}`);
  for (const fItem of files) {
    const put = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(fItem.path)}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ message: `chore(setup): add ${fItem.path}`, content: Buffer.from(fItem.content).toString("base64"), branch })
    });
    if (put.status !== 201) throw new Error(`Add ${fItem.path} failed: ${put.status}`);
  }
  const pr = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ title, head: branch, base, body })
  });
  if (pr.status !== 201) throw new Error(`PR failed: ${pr.status}`);
  return pr.json();
}

export async function openEditRcPR({ owner, repo, token, branch, newContent }: {
  owner: string; repo: string; token: string; branch: string; newContent: string
}) {
  let res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Repo fetch failed: ${res.status}`);
  const meta = await res.json();
  const base = meta.default_branch || "main";
  res = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${base}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Ref fetch failed: ${res.status}`);
  const ref = await res.json();
  res = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/refs`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: ref.object.sha })
  });
  if (res.status !== 201) throw new Error(`Branch create failed: ${res.status}`);
  const rcPath = ".roadmaprc.json";
  let existingSha: string | undefined = undefined;
  const rcGet = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(rcPath)}?ref=${base}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github.v3+json" }
  });
  if (rcGet.ok) { const j = await rcGet.json(); existingSha = j.sha; }
  const put = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(rcPath)}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ message: `chore(settings): update ${rcPath}`, content: Buffer.from(newContent).toString("base64"), branch, sha: existingSha })
  });
  if (put.status !== 200 && put.status !== 201) throw new Error(`Update ${rcPath} failed: ${put.status}`);
  const pr = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ title: "chore(settings): update .roadmaprc.json", head: branch, base, body: "Edit via dashboard settings" })
  });
  if (pr.status !== 201) throw new Error(`PR failed: ${pr.status}`);
  return pr.json();
}
