import { randomUUID } from "node:crypto";

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

export function getStandaloneRoadmap(id: string): StandaloneRoadmapRecord | null {
  const store = getStore();
  const record = store.roadmaps.get(id);
  return record ? cloneRecord(record) : null;
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
