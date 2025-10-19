import { randomUUID } from "node:crypto";

import { normalizeOwner, normalizeRepo } from "../manual-state";

export type StandaloneRoadmapStatus = {
  problems: string[];
  counts: Record<string, number>;
  total: number;
};

export type StandaloneNormalizedRoadmap = {
  title: string;
  items: Array<Record<string, any>>;
};

export type StandaloneRoadmapRecord = {
  id: string;
  workspace_id: string;
  title: string;
  format: "yaml" | "json";
  source: string;
  normalized: StandaloneNormalizedRoadmap;
  status: StandaloneRoadmapStatus;
  is_current: boolean;
  created_at: string;
  updated_at: string;
};

type RoadmapStore = {
  roadmaps: Map<string, StandaloneRoadmapRecord>;
};

const STORE_KEY = Symbol.for("__standaloneRoadmapStore");

type GlobalWithStore = typeof globalThis & {
  [STORE_KEY]?: RoadmapStore;
};

function getStore(): RoadmapStore {
  const globalScope = globalThis as GlobalWithStore;

  if (!globalScope[STORE_KEY]) {
    globalScope[STORE_KEY] = {
      roadmaps: new Map(),
    };
  }

  return globalScope[STORE_KEY]!;
}

function cloneStatus(status: StandaloneRoadmapStatus): StandaloneRoadmapStatus {
  return {
    problems: [...status.problems],
    counts: { ...status.counts },
    total: status.total,
  };
}

function cloneNormalized(normalized: StandaloneNormalizedRoadmap): StandaloneNormalizedRoadmap {
  return {
    title: normalized.title,
    items: normalized.items.map((item) => ({ ...item })),
  };
}

function cloneRecord(record: StandaloneRoadmapRecord): StandaloneRoadmapRecord {
  return {
    ...record,
    status: cloneStatus(record.status),
    normalized: cloneNormalized(record.normalized),
  };
}

export function insertStandaloneRoadmap(
  input: Omit<StandaloneRoadmapRecord, "id" | "created_at" | "updated_at"> & { id?: string },
): StandaloneRoadmapRecord {
  const store = getStore();
  const id = input.id ?? randomUUID();
  const now = new Date().toISOString();
  const record: StandaloneRoadmapRecord = {
    ...input,
    id,
    created_at: now,
    updated_at: now,
  };
  store.roadmaps.set(id, record);
  return cloneRecord(record);
}

export function deriveStandaloneWorkspaceId(owner: string | undefined, repo: string | undefined): string | null {
  const ownerKey = normalizeOwner(owner);
  const repoKey = normalizeRepo(repo);
  if (!ownerKey || !repoKey) {
    return null;
  }
  return `${ownerKey}/${repoKey}`;
}

export function upsertStandaloneWorkspaceRoadmap(
  input: Omit<StandaloneRoadmapRecord, "id" | "created_at" | "updated_at"> & { id?: string },
): StandaloneRoadmapRecord {
  const store = getStore();
  const now = new Date().toISOString();
  const workspaceId = input.workspace_id;
  const desiredIsCurrent = input.is_current ?? true;

  let targetId: string | null = null;
  let createdAt: string | null = null;

  if (desiredIsCurrent) {
    for (const record of store.roadmaps.values()) {
      if (record.workspace_id === workspaceId && record.is_current) {
        targetId = record.id;
        createdAt = record.created_at;
        break;
      }
    }
  }

  const id = targetId ?? input.id ?? randomUUID();
  const record: StandaloneRoadmapRecord = {
    ...input,
    id,
    is_current: desiredIsCurrent,
    created_at: createdAt ?? now,
    updated_at: now,
  };

  store.roadmaps.set(id, record);

  if (desiredIsCurrent) {
    for (const [entryId, existing] of store.roadmaps) {
      if (entryId === id) {
        continue;
      }
      if (existing.workspace_id === workspaceId && existing.is_current) {
        store.roadmaps.set(entryId, { ...existing, is_current: false, updated_at: now });
      }
    }
  }

  return cloneRecord(record);
}

export function getStandaloneRoadmap(id: string): StandaloneRoadmapRecord | null {
  const store = getStore();
  const record = store.roadmaps.get(id);
  return record ? cloneRecord(record) : null;
}

function normalizeWorkspaceId(value: string | undefined | null): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function getCurrentStandaloneWorkspaceRoadmap(
  workspaceId: string,
): StandaloneRoadmapRecord | null {
  const store = getStore();
  const target = normalizeWorkspaceId(workspaceId);
  if (!target) {
    return null;
  }

  let fallback: StandaloneRoadmapRecord | null = null;

  for (const record of store.roadmaps.values()) {
    const candidateWorkspace = normalizeWorkspaceId(record.workspace_id);
    if (candidateWorkspace !== target) {
      continue;
    }
    if (record.is_current) {
      return cloneRecord(record);
    }
    if (!fallback) {
      fallback = record;
    }
  }

  return fallback ? cloneRecord(fallback) : null;
}

export function computeStandaloneRoadmapStatus(
  normalized: StandaloneNormalizedRoadmap,
): StandaloneRoadmapStatus {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const entry of normalized.items) {
    const id = typeof entry?.id === "string" ? entry.id : "";
    if (!id) {
      continue;
    }
    if (seen.has(id)) {
      problems.push(`Duplicate id: ${id}`);
    }
    seen.add(id);
  }

  const counts = normalized.items.reduce<Record<string, number>>((map, entry) => {
    const status = typeof entry?.status === "string" && entry.status.trim()
      ? entry.status.trim()
      : "todo";
    map[status] = (map[status] ?? 0) + 1;
    return map;
  }, {});

  return {
    problems,
    counts,
    total: normalized.items.length,
  };
}

export function updateStandaloneRoadmapStatus(
  id: string,
  status: StandaloneRoadmapStatus,
): StandaloneRoadmapRecord | null {
  const store = getStore();
  const existing = store.roadmaps.get(id);
  if (!existing) {
    return null;
  }

  const updated: StandaloneRoadmapRecord = {
    ...existing,
    status,
    updated_at: new Date().toISOString(),
  };

  store.roadmaps.set(id, updated);
  return cloneRecord(updated);
}

export function resetStandaloneRoadmapStore() {
  const store = getStore();
  store.roadmaps.clear();
}
