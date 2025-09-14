import { SignJWT, importPKCS8 } from "jose";

const ALG = "RS256";
const GH_APP_ID = process.env.GH_APP_ID || "";
const GH_APP_PRIVATE_KEY = (process.env.GH_APP_PRIVATE_KEY || "").replace(/\\n/g, "\n");
const GH_APP_INSTALLATION_ID = process.env.GH_APP_INSTALLATION_ID || "";
const owner = process.env.GH_OWNER || "SSkylar1";
const repo  = process.env.GH_REPO  || "Roadmap-Kit-Starter";

if (!GH_APP_ID || !GH_APP_PRIVATE_KEY) {
  console.error("Missing GH_APP_ID or GH_APP_PRIVATE_KEY");
  process.exit(1);
}

async function appJwt() {
  const key = await importPKCS8(GH_APP_PRIVATE_KEY, ALG);
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + 9 * 60;
  return await new SignJWT({ iat, exp, iss: GH_APP_ID })
    .setProtectedHeader({ alg: ALG })
    .sign(key);
}

async function main() {
  const jwt = await appJwt();
  const H = { Authorization: `Bearer ${jwt}`, Accept: "application/vnd.github+json" };

  // 1) Check the app identity
  let r = await fetch("https://api.github.com/app", { headers: H });
  console.log("[/app]", r.status, await r.text().then(t=>t.slice(0,300)));

  // 2) List installations
  r = await fetch("https://api.github.com/app/installations", { headers: H });
  const installs = await r.json();
  console.log("[/app/installations count]", Array.isArray(installs) ? installs.length : installs);
  if (Array.isArray(installs)) {
    installs.forEach(i => {
      console.log(` - id=${i.id} account=${i.account?.login} repos_total=${i.repositories_total_count} sel_repos=${i.repository_selection}`);
    });
  }

  // 3) Find which installation covers the repo
  r = await fetch(`https://api.github.com/repos/${owner}/${repo}/installation`, { headers: H });
  console.log(`[repo installation for ${owner}/${repo}]`, r.status);
  if (!r.ok) {
    console.log("Body:", await r.text());
    console.log("If 404 here: app is not installed on this repo OR repo not selected.");
    process.exit(2);
  }
  const inst = await r.json();
  const instId = String(inst.id);
  console.log("installation id:", instId);

  // 4) Try to mint an installation token
  r = await fetch(`https://api.github.com/app/installations/${instId}/access_tokens`, {
    method: "POST", headers: H
  });
  console.log("[access_tokens]", r.status);
  if (!r.ok) {
    console.log("Body:", await r.text());
    process.exit(3);
  }
  const tok = await r.json();
  console.log("token preview:", (tok.token || "").slice(0, 12) + "... (ok)");
}

main().catch(e => { console.error(e); process.exit(1); });