import { normalizeOwner, normalizeProjectId, normalizeRepo } from "../manual-state";
import {
  loadStandaloneStores,
  saveStandaloneStores,
  type StandaloneIngestionStateRecord,
} from "./persistence";

export type StandaloneIngestionState = {
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

function cloneState(state: StandaloneIngestionStateRecord): StandaloneIngestionState {
  return {
    owner: state.owner,
    repo: state.repo,
    project_id: state.project_id ?? "",
    last_commit_sha: state.last_commit_sha ?? null,
    last_commit_message: state.last_commit_message ?? null,
    last_commit_author: state.last_commit_author ?? null,
    last_commit_url: state.last_commit_url ?? null,
    last_commit_at: state.last_commit_at ?? null,
    last_commit_paths: normalizePaths(state.last_commit_paths),
    last_manual_state_at: state.last_manual_state_at ?? null,
    last_run_sha: state.last_run_sha ?? null,
    last_run_at: state.last_run_at ?? null,
    last_run_manual_state_at: state.last_run_manual_state_at ?? null,
    updated_at: state.updated_at ?? null,
  };
}

function findIndex(
  list: StandaloneIngestionState[],
  owner: string,
  repo: string,
  projectId: string,
): number {
  return list.findIndex((entry) => entry.owner === owner && entry.repo === repo && entry.project_id === projectId);
}

export function getStandaloneIngestionState(
  owner: string,
  repo: string,
  project: string,
): StandaloneIngestionState | null {
  const ownerKey = normalizeOwner(owner);
  const repoKey = normalizeRepo(repo);
  const projectId = normalizeProjectId(project ?? null);
  const { ingestionStates } = loadStandaloneStores();
  const normalized = (ingestionStates as StandaloneIngestionStateRecord[]).map((entry) => cloneState(entry));
  const index = findIndex(normalized, ownerKey, repoKey, projectId);
  if (index === -1) return null;
  return normalized[index]!;
}

export function upsertStandaloneIngestionState(state: StandaloneIngestionState): void {
  const ownerKey = normalizeOwner(state.owner);
  const repoKey = normalizeRepo(state.repo);
  const projectId = normalizeProjectId(state.project_id ?? "");
  const stores = loadStandaloneStores();
  const existing = (stores.ingestionStates as StandaloneIngestionStateRecord[]).map((entry) => cloneState(entry));
  const next: StandaloneIngestionState = {
    owner: ownerKey,
    repo: repoKey,
    project_id: projectId,
    last_commit_sha: state.last_commit_sha ?? null,
    last_commit_message: state.last_commit_message ?? null,
    last_commit_author: state.last_commit_author ?? null,
    last_commit_url: state.last_commit_url ?? null,
    last_commit_at: state.last_commit_at ?? null,
    last_commit_paths: normalizePaths(state.last_commit_paths),
    last_manual_state_at: state.last_manual_state_at ?? null,
    last_run_sha: state.last_run_sha ?? null,
    last_run_at: state.last_run_at ?? null,
    last_run_manual_state_at: state.last_run_manual_state_at ?? null,
    updated_at: state.updated_at ?? new Date().toISOString(),
  };
  const index = findIndex(existing, ownerKey, repoKey, projectId);
  if (index === -1) {
    existing.push(next);
  } else {
    existing[index] = next;
  }
  saveStandaloneStores({ ingestionStates: existing });
}

export function listStandaloneIngestionStates(): StandaloneIngestionState[] {
  const { ingestionStates } = loadStandaloneStores();
  return (ingestionStates as StandaloneIngestionStateRecord[]).map((entry) => cloneState(entry));
}
