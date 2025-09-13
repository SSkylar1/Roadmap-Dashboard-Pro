import { importPKCS8, SignJWT } from 'jose';

const GH_APP_ID = process.env.GH_APP_ID || '';
const GH_APP_INSTALLATION_ID = process.env.GH_APP_INSTALLATION_ID || '';
const GH_APP_PRIVATE_KEY = process.env.GH_APP_PRIVATE_KEY || '';
const PAT = process.env.GITHUB_TOKEN || '';
const ALG = 'RS256';

async function appJwt() {
  const privateKey = await importPKCS8(GH_APP_PRIVATE_KEY.replace(/\\n/g, '\n'), ALG);
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + 540; // 9 minutes
  return await new SignJWT({ iat, exp, iss: GH_APP_ID })
    .setProtectedHeader({ alg: ALG })
    .sign(privateKey);
}

async function installationIdForRepo(owner: string, repo: string, jwt: string): Promise<string> {
  if (GH_APP_INSTALLATION_ID) return GH_APP_INSTALLATION_ID;
  const r = await fetch(`https://api.github.com/repos/${owner}/${repo}/installation`, {
    headers: { Authorization: `Bearer ${jwt}`, Accept: 'application/vnd.github+json' },
    cache: 'no-store'
  });
  if (!r.ok) throw new Error(`installation lookup failed: ${r.status}`);
  const j = await r.json();
  return String(j.id);
}

async function installationToken(installationId: string, jwt: string): Promise<string> {
  const r = await fetch(`https://api.github.com/app/installations/${installationId}/access_tokens`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}`, Accept: 'application/vnd.github+json' },
    cache: 'no-store'
  });
  if (!r.ok) throw new Error(`install token failed: ${r.status}`);
  const j = await r.json();
  return j.token as string;
}

export async function getTokenForRepo(owner: string, repo: string): Promise<string> {
  if (GH_APP_ID && GH_APP_PRIVATE_KEY) {
    const jwt = await appJwt();
    const instId = await installationIdForRepo(owner, repo, jwt);
    const token = await installationToken(instId, jwt);
    return token;
  }
  if (PAT) return PAT;
  throw new Error('No GitHub credentials configured');
}
