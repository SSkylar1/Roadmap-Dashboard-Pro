import { STANDALONE_MODE } from "./config";
import {
  normalizeOwner,
  normalizeProjectId,
  normalizeRepo,
} from "./manual-state";
import {
  supabaseSelect,
  supabaseUpsert,
  type PostgrestErrorLike,
} from "./supabase-server";
import {
  getStandaloneIngestionState,
  listStandaloneIngestionStates,
  upsertStandaloneIngestionState,
} from "./standalone/ingestion-state";

const TABLE_NAME = "roadmap_ingestion_state";

export type RoadmapIngestionState = {
  owner: string;
  repo: string;
  project_id: string;
  last_commit_sha: string | null;
  last_commit_message: string | null;
  last_commit_author: string | null;
  last_commit_url: string | null;
  last_commit_at: string | null;
  last_commit_paths: string[];
  last_manual_state_at: string | null;
  last_run_sha: string | null;
  last_run_at: string | null;
  last_run_manual_state_at: string | null;
  updated_at: string | null;
};

export type CommitMetadata = {
  sha: string | null | undefined;
  message?: string | null;
  author?: string | null;
  url?: string | null;
  committed_at?: string | null;
  paths?: string[] | null;
};

export type RunCompletionPayload = {
  commitSha?: string | null;
  manualStateAt?: string | null;
  runAt?: string | null;
};

function supabaseConfigured(): boolean {
  const baseUrl =
    process.env.SB_URL ??
    process.env.SUPABASE_URL ??
    process.env.NEXT_PUBLIC_SB_URL ??
    process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SB_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SB_SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY;
  return Boolean(baseUrl && key);
}

function isMissingTable(error: PostgrestErrorLike): boolean {
  if (!error) return false;
  const code = (error?.code ?? "").toString();
  if (code === "42P01") return true;
  const message = error?.message ?? "";
  const patterns = [/relation .* does not exist/i, /could not find the table/i, /schema cache/i];
  return patterns.some((pattern) => pattern.test(message));
}

function emptyState(owner: string, repo: string, project: string): RoadmapIngestionState {
  return {
    owner,
    repo,
    project_id: project,
    last_commit_sha: null,
    last_commit_message: null,
    last_commit_author: null,
    last_commit_url: null,
    last_commit_at: null,
    last_commit_paths: [],
    last_manual_state_at: null,
    last_run_sha: null,
    last_run_at: null,
    last_run_manual_state_at: null,
    updated_at: null,
  };
}

function normalizePaths(paths?: string[] | null): string[] {
  if (!Array.isArray(paths)) return [];
  const set = new Set<string>();
  for (const entry of paths) {
    if (typeof entry !== "string") continue;
    const trimmed = entry.trim();
    if (!trimmed) continue;
    set.add(trimmed);
  }
  return Array.from(set);
}

function fromRow(row: any, owner: string, repo: string, project: string): RoadmapIngestionState {
  if (!row || typeof row !== "object") {
    return emptyState(owner, repo, project);
  }
  return {
    owner,
    repo,
    project_id: project,
    last_commit_sha: typeof row.last_commit_sha === "string" ? row.last_commit_sha : null,
    last_commit_message: typeof row.last_commit_message === "string" ? row.last_commit_message : null,
    last_commit_author: typeof row.last_commit_author === "string" ? row.last_commit_author : null,
    last_commit_url: typeof row.last_commit_url === "string" ? row.last_commit_url : null,
    last_commit_at: typeof row.last_commit_at === "string" ? row.last_commit_at : null,
    last_commit_paths: Array.isArray(row.last_commit_paths)
      ? normalizePaths(row.last_commit_paths as string[])
      : normalizePaths(row.last_commit_paths_json ?? row.last_commit_paths),
    last_manual_state_at: typeof row.last_manual_state_at === "string" ? row.last_manual_state_at : null,
    last_run_sha: typeof row.last_run_sha === "string" ? row.last_run_sha : null,
    last_run_at: typeof row.last_run_at === "string" ? row.last_run_at : null,
    last_run_manual_state_at:
      typeof row.last_run_manual_state_at === "string" ? row.last_run_manual_state_at : null,
    updated_at: typeof row.updated_at === "string" ? row.updated_at : null,
  };
}

export async function getIngestionState(
  owner: string,
  repo: string,
  project?: string | null,
): Promise<RoadmapIngestionState | null> {
  const ownerKey = normalizeOwner(owner);
  const repoKey = normalizeRepo(repo);
  const projectId = normalizeProjectId(project ?? null);
  if (!ownerKey || !repoKey) {
    return null;
  }

  if (STANDALONE_MODE || !supabaseConfigured()) {
    const record = getStandaloneIngestionState(ownerKey, repoKey, projectId);
    if (!record) {
      return emptyState(ownerKey, repoKey, projectId);
    }
    return mergeState(null, ownerKey, repoKey, projectId, record);
  }

  const { data, error } = await supabaseSelect<any>(
    TABLE_NAME,
    "last_commit_sha,last_commit_message,last_commit_author,last_commit_url,last_commit_at,last_commit_paths,last_manual_state_at,last_run_sha,last_run_at,last_run_manual_state_at,updated_at",
    {
      owner: `eq.${ownerKey}`,
      repo: `eq.${repoKey}`,
      project_id: `eq.${projectId}`,
    },
  );

  if (error) {
    if (isMissingTable(error)) {
      throw new Error(
        "Supabase table roadmap_ingestion_state not found. Apply the SQL in docs/supabase-roadmap-progress.sql to provision it.",
      );
    }
    throw new Error(error.message ?? "Unexpected Supabase error");
  }

  const row = Array.isArray(data) && data.length > 0 ? data[0] : null;
  if (!row) {
    return emptyState(ownerKey, repoKey, projectId);
  }
  return fromRow(row, ownerKey, repoKey, projectId);
}

function mergeState(
  existing: RoadmapIngestionState | null,
  owner: string,
  repo: string,
  project: string,
  patch: Partial<RoadmapIngestionState>,
): RoadmapIngestionState {
  const base = existing ?? emptyState(owner, repo, project);
  return {
    ...base,
    ...patch,
    last_commit_paths: normalizePaths(patch.last_commit_paths ?? base.last_commit_paths),
  };
}

export async function recordCommitMetadata(
  owner: string,
  repo: string,
  project: string | null,
  metadata: CommitMetadata,
): Promise<RoadmapIngestionState | null> {
  const ownerKey = normalizeOwner(owner);
  const repoKey = normalizeRepo(repo);
  const projectId = normalizeProjectId(project ?? null);
  if (!ownerKey || !repoKey) return null;

  const normalizedPaths = normalizePaths(metadata.paths ?? []);
  const patch: Partial<RoadmapIngestionState> = {
    last_commit_sha: metadata.sha ?? null,
    last_commit_message: metadata.message ?? null,
    last_commit_author: metadata.author ?? null,
    last_commit_url: metadata.url ?? null,
    last_commit_at: metadata.committed_at ?? null,
    last_commit_paths: normalizedPaths,
  };

  if (STANDALONE_MODE || !supabaseConfigured()) {
    const currentRecord = getStandaloneIngestionState(ownerKey, repoKey, projectId);
    const current = currentRecord ? mergeState(null, ownerKey, repoKey, projectId, currentRecord) : null;
    const next = mergeState(current, ownerKey, repoKey, projectId, patch);
    upsertStandaloneIngestionState(next);
    return next;
  }

  const now = new Date().toISOString();
  const { error } = await supabaseUpsert<any>(TABLE_NAME, [
    {
      owner: ownerKey,
      repo: repoKey,
      project_id: projectId,
      last_commit_sha: patch.last_commit_sha,
      last_commit_message: patch.last_commit_message,
      last_commit_author: patch.last_commit_author,
      last_commit_url: patch.last_commit_url,
      last_commit_at: patch.last_commit_at,
      last_commit_paths: normalizedPaths,
      updated_at: now,
    },
  ]);

  if (error) {
    if (isMissingTable(error)) {
      throw new Error(
        "Supabase table roadmap_ingestion_state not found. Apply the SQL in docs/supabase-roadmap-progress.sql to provision it.",
      );
    }
    throw new Error(error.message ?? "Unexpected Supabase error");
  }

  return mergeState(null, ownerKey, repoKey, projectId, { ...patch, updated_at: now });
}

export async function markManualStateUpdated(
  owner: string,
  repo: string,
  project: string | null,
  updatedAt: string | null,
): Promise<RoadmapIngestionState | null> {
  const ownerKey = normalizeOwner(owner);
  const repoKey = normalizeRepo(repo);
  const projectId = normalizeProjectId(project ?? null);
  if (!ownerKey || !repoKey) return null;

  const patch: Partial<RoadmapIngestionState> = {
    last_manual_state_at: updatedAt,
  };

  if (STANDALONE_MODE || !supabaseConfigured()) {
    const currentRecord = getStandaloneIngestionState(ownerKey, repoKey, projectId);
    const current = currentRecord ? mergeState(null, ownerKey, repoKey, projectId, currentRecord) : null;
    const next = mergeState(current, ownerKey, repoKey, projectId, patch);
    upsertStandaloneIngestionState(next);
    return next;
  }

  const now = new Date().toISOString();
  const { error } = await supabaseUpsert<any>(TABLE_NAME, [
    {
      owner: ownerKey,
      repo: repoKey,
      project_id: projectId,
      last_manual_state_at: updatedAt,
      updated_at: now,
    },
  ]);

  if (error) {
    if (isMissingTable(error)) {
      throw new Error(
        "Supabase table roadmap_ingestion_state not found. Apply the SQL in docs/supabase-roadmap-progress.sql to provision it.",
      );
    }
    throw new Error(error.message ?? "Unexpected Supabase error");
  }

  return mergeState(null, ownerKey, repoKey, projectId, { ...patch, updated_at: now });
}

export async function markRunComplete(
  owner: string,
  repo: string,
  project: string | null,
  payload: RunCompletionPayload,
): Promise<RoadmapIngestionState | null> {
  const ownerKey = normalizeOwner(owner);
  const repoKey = normalizeRepo(repo);
  const projectId = normalizeProjectId(project ?? null);
  if (!ownerKey || !repoKey) return null;

  const patch: Partial<RoadmapIngestionState> = {
    last_run_sha: payload.commitSha ?? null,
    last_run_manual_state_at: payload.manualStateAt ?? null,
    last_run_at: payload.runAt ?? new Date().toISOString(),
  };

  if (STANDALONE_MODE || !supabaseConfigured()) {
    const currentRecord = getStandaloneIngestionState(ownerKey, repoKey, projectId);
    const current = currentRecord ? mergeState(null, ownerKey, repoKey, projectId, currentRecord) : null;
    const next = mergeState(current, ownerKey, repoKey, projectId, patch);
    upsertStandaloneIngestionState(next);
    return next;
  }

  const now = payload.runAt ?? new Date().toISOString();
  const { error } = await supabaseUpsert<any>(TABLE_NAME, [
    {
      owner: ownerKey,
      repo: repoKey,
      project_id: projectId,
      last_run_sha: patch.last_run_sha,
      last_run_manual_state_at: patch.last_run_manual_state_at,
      last_run_at: now,
      updated_at: now,
    },
  ]);

  if (error) {
    if (isMissingTable(error)) {
      throw new Error(
        "Supabase table roadmap_ingestion_state not found. Apply the SQL in docs/supabase-roadmap-progress.sql to provision it.",
      );
    }
    throw new Error(error.message ?? "Unexpected Supabase error");
  }

  return mergeState(null, ownerKey, repoKey, projectId, {
    ...patch,
    last_run_at: now,
    updated_at: now,
  });
}

export async function listAllIngestionStates(): Promise<RoadmapIngestionState[]> {
  if (STANDALONE_MODE || !supabaseConfigured()) {
    return listStandaloneIngestionStates().map((entry) =>
      mergeState(null, entry.owner, entry.repo, entry.project_id, entry),
    );
  }

  const { data, error } = await supabaseSelect<any>(
    TABLE_NAME,
    "owner,repo,project_id,last_commit_sha,last_commit_message,last_commit_author,last_commit_url,last_commit_at,last_commit_paths,last_manual_state_at,last_run_sha,last_run_at,last_run_manual_state_at,updated_at",
  );

  if (error) {
    if (isMissingTable(error)) {
      throw new Error(
        "Supabase table roadmap_ingestion_state not found. Apply the SQL in docs/supabase-roadmap-progress.sql to provision it.",
      );
    }
    throw new Error(error.message ?? "Unexpected Supabase error");
  }

  if (!Array.isArray(data)) return [];
  return data.map((row) =>
    fromRow(
      row,
      typeof row.owner === "string" ? row.owner : "",
      typeof row.repo === "string" ? row.repo : "",
      typeof row.project_id === "string" ? row.project_id : "",
    ),
  );
}
