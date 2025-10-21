import { randomUUID } from "node:crypto";

import { loadStandaloneStores, saveStandaloneStores } from "./persistence";

export type StandaloneStatusPayload = Record<string, any>;

export type StandaloneStatusSnapshot = {
  id: string;
  workspace_id: string;
  project_id: string | null;
  branch: string | null;
  payload: StandaloneStatusPayload;
  created_at: string;
};

type SnapshotStore = {
  snapshots: StandaloneStatusSnapshot[];
};

const STORE_KEY = Symbol.for("__standaloneStatusSnapshots");

type GlobalWithStore = typeof globalThis & {
  [STORE_KEY]?: SnapshotStore;
};

function getStore(): SnapshotStore {
  const globalScope = globalThis as GlobalWithStore;
  if (!globalScope[STORE_KEY]) {
    const { statusSnapshots } = loadStandaloneStores();
    globalScope[STORE_KEY] = { snapshots: statusSnapshots.map((snapshot) => cloneSnapshot(snapshot)) };
  }
  return globalScope[STORE_KEY]!;
}

function deepClone<T>(value: T): T {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (typeof globalThis.structuredClone === "function") {
    return globalThis.structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

function cloneSnapshot(snapshot: StandaloneStatusSnapshot): StandaloneStatusSnapshot {
  return {
    ...snapshot,
    payload: deepClone(snapshot.payload),
  };
}

export function insertStandaloneStatusSnapshot(
  input: Omit<StandaloneStatusSnapshot, "id" | "created_at"> & { id?: string; created_at?: string },
): StandaloneStatusSnapshot {
  const store = getStore();
  const id = input.id ?? randomUUID();
  const created = input.created_at ?? new Date().toISOString();
  const projectValue =
    typeof input.project_id === "string" && input.project_id.trim() !== ""
      ? input.project_id
      : null;
  const branchValue =
    typeof input.branch === "string" && input.branch.trim() !== ""
      ? input.branch
      : null;
  const record: StandaloneStatusSnapshot = {
    id,
    created_at: created,
    workspace_id: input.workspace_id,
    project_id: projectValue,
    branch: branchValue,
    payload: deepClone(input.payload),
  };
  store.snapshots.push(record);
  saveStandaloneStores({ statusSnapshots: store.snapshots.map((snapshot) => cloneSnapshot(snapshot)) });
  return cloneSnapshot(record);
}

export function getLatestStandaloneStatusSnapshot(
  workspaceId: string,
  projectId?: string | null,
  branch?: string | null,
): StandaloneStatusSnapshot | null {
  const store = getStore();
  const normalizedProject = projectId ?? null;
  const normalizedBranch = branch ?? null;

  const matches = store.snapshots.filter((snapshot) => {
    if (snapshot.workspace_id !== workspaceId) return false;
    const snapshotProject = snapshot.project_id ?? null;
    const projectMatches = normalizedProject === null ? snapshotProject === null : snapshotProject === normalizedProject;
    if (!projectMatches) return false;
    if (normalizedBranch === null) {
      return true;
    }
    return (snapshot.branch ?? null) === normalizedBranch;
  });

  if (matches.length === 0) {
    return null;
  }

  const sorted = matches.slice().sort((a, b) => {
    if (a.created_at === b.created_at) return 0;
    return a.created_at > b.created_at ? -1 : 1;
  });

  return cloneSnapshot(sorted[0]!);
}

export function resetStandaloneStatusSnapshotStore() {
  const store = getStore();
  store.snapshots = [];
  saveStandaloneStores({ statusSnapshots: [] });
}
