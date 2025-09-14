// lib/token.ts
import { importPKCS8, SignJWT } from "jose";

const GH_APP_ID  = process.env.GH_APP_ID || "";
const GH_APP_PRIVATE_KEY = process.env.GH_APP_PRIVATE_KEY || "";
const GH_APP_PRIVATE_KEY_B64 = process.env.GH_APP_PRIVATE_KEY_B64 || "";
const PAT = process.env.GITHUB_TOKEN || "";
const ALG = "RS256";
const GH_HEADERS = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
} as const;

function need(name: string, v?: string) {
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

async function loadPrivateKey() {
  let pem = GH_APP_PRIVATE_KEY;
  if (!pem && GH_APP_PRIVATE_KEY_B64) {
    pem = Buffer.from(GH_APP_PRIVATE_KEY_B64, "base64").toString("utf8");
  }
  pem = need("GH_APP_PRIVATE_KEY (or GH_APP_PRIVATE_KEY_B64)", pem);
  // jose importPKCS8 needs PKCS#8 ("BEGIN PRIVATE KEY"). Many GH keys are PKCS#1 ("BEGIN RSA PRIVATE KEY").
  if (!/^-----BEGIN (?:PRIVATE|RSA PRIVATE) KEY-----/.test(pem)) {
    throw new Error("GitHub App key must be a PEM string with BEGIN/END lines");
  }
  // If it's RSA (PKCS#1), many setups still work as GitHub now issues PKCS#8 by default.
  // If yours is PKCS#1 and import fails, re-generate the key from GitHub (PKCS#8).
  return importPKCS8(pem.replace(/\\n/g, "\n"), ALG);
}

async function appJwt(): Promise<string> {
  const key = await loadPrivateKey();
  const iat = Math.floor(Date.now() / 1000) - 60; // clock skew tolerance
  const exp = iat + 9 * 60; // <= 10 min
  return await new SignJWT({}) // put std claims via setters
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt(iat)
    .setExpirationTime(exp)
    .setIssuer(need("GH_APP_ID", GH_APP_ID))
    .sign(key);
}

async function fetchJson(url: string, init: RequestInit) {
  const r = await fetch(url, init);
  const text = await r.text();
  let j: any;
  try { j = text ? JSON.parse(text) : {}; } catch { j = { raw: text }; }
  if (!r.ok) {
    const detail = j?.message || j?.error || text || `${r.status}`;
    throw new Error(`${init.method || "GET"} ${url} -> ${r.status} ${detail}`);
  }
  return j;
}

async function installationIdForRepo(owner: string, repo: string, jwt: string): Promise<string> {
  // ALWAYS look it up by repo to avoid stale env values
  const j = await fetchJson(
    `https://api.github.com/repos/${owner}/${repo}/installation`,
    { headers: { Authorization: `Bearer ${jwt}`, ...GH_HEADERS }, cache: "no-store" }
  );
  return String(j.id);
}

async function installationToken(installationId: string, jwt: string): Promise<string> {
  const j = await fetchJson(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${jwt}`, ...GH_HEADERS },
      cache: "no-store",
      // If you want to scope to a single repo, add a JSON body:
      // body: JSON.stringify({ repositories: [repo], permissions: { contents: "write", pull_requests: "write" } })
    }
  );
  return j.token as string;
}

export async function getTokenForRepo(owner: string, repo: string): Promise<string> {
  // Prefer GitHub App; fall back to PAT only if App creds missing
  if (GH_APP_ID && (GH_APP_PRIVATE_KEY || GH_APP_PRIVATE_KEY_B64)) {
    const jwt = await appJwt();
    const instId = await installationIdForRepo(owner, repo, jwt);
    return await installationToken(instId, jwt);
  }
  if (PAT) return PAT;
  throw new Error("No GitHub credentials configured (need GH_APP_ID + key, or GITHUB_TOKEN)");
}