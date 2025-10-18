// Node 20+. Writes multiple files via GitHub Contents API (each is its own signed commit).
// ENV required: GH_INSTALLATION_TOKEN, REPO_OWNER, REPO_NAME, DEFAULT_BRANCH
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import fetch from "node-fetch";

const {
  GH_INSTALLATION_TOKEN,
  REPO_OWNER,
  REPO_NAME,
  DEFAULT_BRANCH = "main",
} = process.env;

if (!GH_INSTALLATION_TOKEN) throw new Error("Missing GH_INSTALLATION_TOKEN");

async function getCurrentSha(path) {
  const r = await fetch(
    `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${encodeURIComponent(path)}?ref=${DEFAULT_BRANCH}`,
    { headers: { Authorization: `token ${GH_INSTALLATION_TOKEN}`, Accept: "application/vnd.github+json" } }
  );
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GET ${path} failed: ${r.status}`);
  const json = await r.json();
  return json.sha || null;
}

async function putFile({ path, content, message }) {
  const prevSha = await getCurrentSha(path);
  const body = {
    message,
    content: Buffer.from(content).toString("base64"),
    branch: DEFAULT_BRANCH,
    sha: prevSha || undefined,
    committer: { name: "roadmap-context-kit", email: "bot@users.noreply.github.com" },
    author: { name: "roadmap-context-kit", email: "bot@users.noreply.github.com" },
  };
  const r = await fetch(
    `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${encodeURIComponent(path)}`,
    {
      method: "PUT",
      headers: {
        Authorization: `token ${GH_INSTALLATION_TOKEN}`,
        Accept: "application/vnd.github+json",
      },
      body: JSON.stringify(body),
    }
  );
  if (!r.ok) throw new Error(`PUT ${path} failed: ${r.status} ${await r.text()}`);
}

async function main() {
  // Example writes (add your own):
  await putFile({
    path: ".roadmaprc.json",
    content: readFileSync(".roadmaprc.json", "utf8"),
    message: "chore: add/update .roadmaprc.json",
  });
  await putFile({
    path: "docs/roadmap-status.json",
    content: readFileSync("docs/roadmap-status.json", "utf8"),
    message: "chore: add/update docs/roadmap-status.json",
  });
  await putFile({
    path: "scripts/roadmap-check.mjs",
    content: readFileSync("scripts/roadmap-check.mjs", "utf8"),
    message: "chore: add/update scripts/roadmap-check.mjs",
  });
  // If you truly must update package files, do it here too:
  // await putFile({ path: "package.json", content: readFileSync("package.json", "utf8"), message: "chore: add/update package.json" });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
