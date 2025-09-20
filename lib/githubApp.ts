// lib/github-app.ts
// Node.js runtime ONLY. Any Next.js route that imports this file must set:
//   export const runtime = "nodejs";

import crypto from "node:crypto";

/** ========= Env handling (throws early if missing) ========= */

const GH_APP_ID = process.env.GH_APP_ID; // MUST be the numeric GitHub App ID (e.g. "123456")
const GH_APP_INSTALLATION_ID = process.env.GH_APP_INSTALLATION_ID ?? null;

// Preferred: single-line base64 of the PEM to avoid multiline .env issues
const GH_APP_PRIVATE_KEY_B64 = process.env.GH_APP_PRIVATE_KEY_B64 ?? null;

// Fallback: raw PEM (multiline) if you're only running locally and not using base64
const GH_APP_PRIVATE_KEY_RAW = process.env.GH_APP_PRIVATE_KEY ?? null;

// Decode to PEM string once at module load and assert it's present
const GH_APP_PRIVATE_KEY: string = (() => {
  const fromB64 = GH_APP_PRIVATE_KEY_B64
    ? Buffer.from(GH_APP_PRIVATE_KEY_B64, "base64").toString("utf8")
    : null;

  const pem = fromB64 ?? GH_APP_PRIVATE_KEY_RAW;
  if (!pem) {
    throw new Error(
      "Missing GitHub App private key — set GH_APP_PRIVATE_KEY_B64 (preferred) or GH_APP_PRIVATE_KEY."
    );
  }
  return pem;
})();

if (!GH_APP_ID) {
  throw new Error("Missing GH_APP_ID (must be the numeric GitHub App ID).");
}

/** ========= JWT creation ========= */

function b64url(obj: object) {
  return Buffer.from(JSON.stringify(obj)).toString("base64url");
}

function createAppJWT(): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iat: now - 60,   // allow 60s clock skew
    exp: now + 9 * 60, // ~9 minutes validity
    iss: GH_APP_ID,  // numeric App ID
  };

  const data = `${b64url(header)}.${b64url(payload)}`;

  // Convert to a KeyObject so TypeScript knows it's a valid key type
  const keyObj = crypto.createPrivateKey(GH_APP_PRIVATE_KEY);
  const signature = crypto.createSign("RSA-SHA256").update(data).sign(keyObj, "base64url");

  return `${data}.${signature}`;
}

/** ========= Token caching ========= */

let cachedToken: { token: string; expiresAt: number } | null = null;

/** Resolve installation id (uses env if provided, otherwise lists and picks first) */
async function resolveInstallationId(jwt: string): Promise<string> {
  if (GH_APP_INSTALLATION_ID) return GH_APP_INSTALLATION_ID;

  const res = await fetch("https://api.github.com/app/installations", {
    headers: {
      Authorization: `Bearer ${jwt}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "roadmap-dashboard-pro",
    },
  });

  if (!res.ok) {
    throw new Error(`list installations failed: ${res.status} ${await res.text()}`);
  }

  const arr = (await res.json()) as Array<{ id: number }>;
  const id = arr[0]?.id;
  if (!id) throw new Error("No installations found for this App.");
  return String(id);
}

/** Exchange App JWT for an installation access token (with caching) */
export async function getInstallationToken(): Promise<string> {
  // Reuse if >60s of validity left
  if (cachedToken && cachedToken.expiresAt - Date.now() > 60_000) {
    return cachedToken.token;
  }

  const jwt = createAppJWT();
  const installationId = await resolveInstallationId(jwt);

  const tokRes = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "roadmap-dashboard-pro",
      },
    }
  );

  if (!tokRes.ok) {
    throw new Error(`access token failed: ${tokRes.status} ${await tokRes.text()}`);
  }

  const json = (await tokRes.json()) as { token: string; expires_at: string };

  cachedToken = {
    token: json.token,
    expiresAt: new Date(json.expires_at).getTime(),
  };

  return json.token;
}

