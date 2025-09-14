// lib/githubApp.ts
import crypto from "crypto";

const GH_APP_ID = process.env.GH_APP_ID || process.env.GH_CLIENT_ID;
const GH_APP_PRIVATE_KEY = process.env.GH_APP_PRIVATE_KEY!;
const GH_APP_INSTALLATION_ID = process.env.GH_APP_INSTALLATION_ID;

/** Encode to base64url (RFC 7515 §2) */
function b64url(obj: object) {
  return Buffer.from(JSON.stringify(obj)).toString("base64url");
}

/** Create a short-lived JWT for the GitHub App */
function createAppJWT(): string {
  if (!GH_APP_ID || !GH_APP_PRIVATE_KEY) {
    throw new Error("GitHub App env vars missing");
  }
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iat: now - 60, // 1 min early for clock skew
    exp: now + 9 * 60, // valid for 10 min
    iss: GH_APP_ID, // can be App ID or Client ID
  };
  const header = { alg: "RS256", typ: "JWT" };
  const data = `${b64url(header)}.${b64url(payload)}`;
  const signature = crypto
    .createSign("RSA-SHA256")
    .update(data)
    .sign(GH_APP_PRIVATE_KEY, "base64url");
  return `${data}.${signature}`;
}

/** Exchange App JWT for an installation access token */
export async function getInstallationToken(): Promise<string> {
  const jwt = createAppJWT();

  let installationId = GH_APP_INSTALLATION_ID;
  if (!installationId) {
    // fallback: list installations
    const li = await fetch("https://api.github.com/app/installations", {
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: "application/vnd.github+json",
      },
    });
    if (!li.ok) {
      throw new Error(`list installations failed: ${li.status}`);
    }
    const arr = (await li.json()) as Array<{ id: number }>;
    installationId = String(arr[0]?.id);
  }

  const tokRes = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: "application/vnd.github+json",
      },
    }
  );
  if (!tokRes.ok) {
    throw new Error(`access token failed: ${tokRes.status}`);
  }
  const json = (await tokRes.json()) as { token: string; expires_at: string };
  return json.token;
}
