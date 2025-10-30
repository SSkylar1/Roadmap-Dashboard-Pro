export type RepoAuth = {
  token: string;
  scheme: "token";
  source: "pat";
};

export function authHeaders(auth: RepoAuth, extra: Record<string, string> = {}) {
  return { Authorization: `${auth.scheme} ${auth.token}`, ...extra };
}

export async function getTokenForRepo(): Promise<RepoAuth> {
  return { token: "stub-token", scheme: "token", source: "pat" };
}
