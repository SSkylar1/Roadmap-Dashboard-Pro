export type ContextPackRepoMeta = {
  owner?: string;
  name?: string;
  branch?: string;
  project?: string;
};

export type ContextPackPayload = {
  generated_at?: string;
  source?: string;
  repo?: ContextPackRepoMeta;
  files?: Record<string, string>;
};

export type ContextPackResponse = ContextPackPayload & {
  error?: string;
  missing?: string[];
};

export type ContextExportOptions = {
  owner: string;
  repo: string;
  branch: string;
  project?: string | null;
  githubPat?: string | null;
};

export async function fetchContextPack(
  { owner, repo, branch, project, githubPat }: ContextExportOptions,
  fetchImpl: typeof fetch = fetch,
): Promise<ContextPackResponse> {
  const contextHeaders: HeadersInit = { Accept: "application/json" };
  if (githubPat) {
    contextHeaders["x-github-pat"] = githubPat;
  }

  const projectQuery = project ? `&project=${encodeURIComponent(project)}` : "";
  const url = `/api/context/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}?branch=${encodeURIComponent(branch)}${projectQuery}`;

  const response = await fetchImpl(url, { cache: "no-store", headers: contextHeaders });
  const json = (await response.json()) as ContextPackResponse;

  if (!response.ok || json?.error) {
    const missing = json?.missing?.length ? ` Missing files: ${json.missing.join(", ")}.` : "";
    throw new Error(json?.error ? `${json.error}.${missing}` : `Failed to export context pack.${missing}`);
  }

  return json;
}
