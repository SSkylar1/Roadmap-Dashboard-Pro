import type { NextRequest } from "next/server";

export type TriggerRunOptions = {
  owner: string;
  repo: string;
  branch?: string | null;
  project?: string | null;
  commitSha?: string | null;
  manualStateUpdatedAt?: string | null;
  changedPaths?: string[];
  runAt?: string;
};

export type TriggerRunResult = {
  ok: boolean;
  status: number;
  body: unknown;
};

function buildRunUrl(req: NextRequest): string {
  const url = new URL(req.url);
  url.pathname = "/api/run";
  url.search = "";
  url.hash = "";
  return url.toString();
}

function resolveGithubToken(): string | undefined {
  return process.env.GITHUB_WEBHOOK_PAT || process.env.GITHUB_TOKEN;
}

function resolveOpenAiKey(): string | undefined {
  return process.env.RUNNER_OPENAI_KEY || process.env.OPENAI_API_KEY;
}

export async function triggerRun(
  req: NextRequest,
  options: TriggerRunOptions,
): Promise<TriggerRunResult> {
  const url = buildRunUrl(req);
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  const githubToken = resolveGithubToken();
  if (githubToken) {
    headers["x-github-pat"] = githubToken;
  }
  const openAiKey = resolveOpenAiKey();
  if (openAiKey) {
    headers["x-openai-key"] = openAiKey;
  }

  const payload = {
    owner: options.owner,
    repo: options.repo,
    branch: options.branch ?? undefined,
    project: options.project ?? undefined,
    commitSha: options.commitSha ?? undefined,
    manualStateUpdatedAt: options.manualStateUpdatedAt ?? undefined,
    changedPaths: Array.isArray(options.changedPaths) ? options.changedPaths : undefined,
    runAt: options.runAt ?? new Date().toISOString(),
  };

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  const body = await response
    .json()
    .catch(async () => {
      const text = await response.text().catch(() => "");
      return text;
    })
    .catch(() => null);

  return {
    ok: response.ok,
    status: response.status,
    body,
  };
}
