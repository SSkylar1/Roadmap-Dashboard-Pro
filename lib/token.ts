// lib/token.ts
import { importPKCS8, SignJWT } from "jose";

const GH_APP_ID = process.env.GH_APP_ID || "";
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

/**
 * Load the GitHub App private key as a PEM string.
 * Supports both:
 *   - GH_APP_PRIVATE_KEY (raw PEM, multiline or escaped)
 *   - GH_APP_PRIVATE_KEY_B64 (base64-encoded PEM, recommended for Vercel)
 */
async function loadPrivateKey() {
  let pem = GH_APP_PRIVATE_KEY;

  // Prefer base64 if set
  if (!pem && GH_APP_PRIVATE_KEY_B64) {
    pem = Buffer.from(GH_APP_PRIVATE_KEY_B64, "base64").toString("utf8");
  }

  pem = need("GH_APP_PRIVATE_KEY (or GH_APP_PRIVATE_KEY_B64)", pem);

  // Ensure PEM looks correct
  if (!/^-----BEGIN (?:PRIVATE|RSA PRIVATE) KEY-----/.test(pem)) {
    throw new Error("GitHub App key must be a PEM string with BEGIN/END lines");
  }

  // Replace escaped newlines if necessary
  return importPKCS8(pem.replace(/\\n/g, "\n"), ALG);
}

/**
 * Create a short-lived GitHub App JWT
 */
async function appJwt(): Promise<string> {
  const key = await loadPrivateKey();
  const iat = Math.floor(Date.now() / 1000) - 60; // tolerate clock skew
  const exp = iat + 9 * 60; // must be <= 10 min

  return await new SignJWT({})
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
  try {
    j = text ? JSON.parse(text) : {};
  } catch {
    j = { raw: text };
  }

  if (!r.ok) {
    const detail = j?.message || j?.error || text || `${r.status}`;
    throw new Error(`${init.method || "GET"} ${url} -> ${r.status} ${detail}`);
  }
  return j;
}

/**
 * Look up the installation ID for the given repo
 * Always resolves fresh from GitHub API, never from env
 */
async function installationIdForRepo(owner: string, repo: string, jwt: string): Promise<string> {
  const j = await fetchJson(
    `https://api.github.com/repos/${owner}/${repo}/installation`,
    { headers: { Authorization: `Bearer ${jwt}`, ...GH_HEADERS }, cache: "no-store" }
  );
  return String(j.id);
}

/**
 * Mint an installation access token scoped to this repo
 */
async function installationToken(installationId: string, jwt: string): Promise<string> {
  const j = await fetchJson(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${jwt}`, ...GH_HEADERS },
      cache: "no-store",
      // Optional: scope further to a single repo + permissions
      // body: JSON.stringify({ repositories: [repo], permissions: { contents: "write", pull_requests: "write" } })
    }
  );
  return j.token as string;
}

/**
 * Main entry: get a GitHub token valid for a repo
 * Prefers GitHub App credentials, falls back to PAT
 */
export async function getTokenForRepo(owner: string, repo: string): Promise<string> {
  if (GH_APP_ID && (GH_APP_PRIVATE_KEY || GH_APP_PRIVATE_KEY_B64)) {
    const jwt = await appJwt();
    const instId = await installationIdForRepo(owner, repo, jwt);
    return await installationToken(instId, jwt);
  }

  if (PAT) return PAT;

  throw new Error(
    "No GitHub credentials configured. Need GH_APP_ID + GH_APP_PRIVATE_KEY(_B64) or GITHUB_TOKEN"
  );
}