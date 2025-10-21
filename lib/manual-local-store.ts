import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import type { ManualState } from "./manual-state";
import { manualStateIsEmpty, sanitizeManualState } from "./manual-state";

const DEFAULT_RELATIVE_PATH = ".roadmap-dashboard/manual-store.json";
const STORE_PATH = resolve(
  process.cwd(),
  process.env.ROADMAP_DASHBOARD_MANUAL_STORE_PATH ?? DEFAULT_RELATIVE_PATH,
);

type ManualLocalStoreRecord = {
  owner: string;
  repo: string;
  project_id: string;
  state: ManualState;
  updated_at: string | null;
};

type ManualLocalStorePayload = {
  records: ManualLocalStoreRecord[];
};

let cache: ManualLocalStorePayload | null = null;

function deepClone<T>(value: T): T {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (typeof globalThis.structuredClone === "function") {
    return globalThis.structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

function ensureDirectoryExists(path: string) {
  const directory = dirname(path);
  mkdirSync(directory, { recursive: true });
}

function normalizeRecord(raw: any): ManualLocalStoreRecord | null {
  const owner = typeof raw?.owner === "string" ? raw.owner : null;
  const repo = typeof raw?.repo === "string" ? raw.repo : null;
  const project_id = typeof raw?.project_id === "string" ? raw.project_id : null;
  if (!owner || !repo || project_id === null) {
    return null;
  }

  const updated_at = typeof raw?.updated_at === "string" ? raw.updated_at : null;
  const state = sanitizeManualState(raw?.state);
  return {
    owner,
    repo,
    project_id,
    state,
    updated_at,
  };
}

function normalizePayload(payload: any): ManualLocalStorePayload {
  const records: ManualLocalStoreRecord[] = Array.isArray(payload?.records)
    ? payload.records
        .map(normalizeRecord)
        .filter(
          (record: ManualLocalStoreRecord | null): record is ManualLocalStoreRecord =>
            Boolean(record),
        )
    : [];
  return { records };
}

function readFromDisk(): ManualLocalStorePayload {
  try {
    const raw = readFileSync(STORE_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    return normalizePayload(parsed);
  } catch (error) {
    return { records: [] };
  }
}

function writeToDisk(payload: ManualLocalStorePayload) {
  ensureDirectoryExists(STORE_PATH);
  const serialized = JSON.stringify(payload, null, 2);
  writeFileSync(STORE_PATH, `${serialized}\n`, "utf-8");
}

function ensureCache(): ManualLocalStorePayload {
  if (!cache) {
    cache = readFromDisk();
  }
  return cache;
}

function setCache(payload: ManualLocalStorePayload) {
  cache = payload;
  writeToDisk(payload);
}

function findRecordIndex(
  records: ManualLocalStoreRecord[],
  owner: string,
  repo: string,
  project_id: string,
): number {
  return records.findIndex(
    (record) =>
      record.owner === owner && record.repo === repo && record.project_id === project_id,
  );
}

export function loadManualStateLocal(
  owner: string,
  repo: string,
  project_id: string,
): { state: ManualState; updated_at: string | null } {
  const current = ensureCache();
  const index = findRecordIndex(current.records, owner, repo, project_id);
  if (index === -1) {
    return { state: {}, updated_at: null };
  }
  const record = current.records[index];
  return { state: deepClone(record.state), updated_at: record.updated_at ?? null };
}

export function upsertManualStateLocal(
  owner: string,
  repo: string,
  project_id: string,
  state: ManualState,
): { state: ManualState; updated_at: string } {
  const sanitized = sanitizeManualState(state);
  const current = ensureCache();
  const nextRecords = deepClone(current.records);
  const now = new Date().toISOString();
  const index = findRecordIndex(nextRecords, owner, repo, project_id);
  const record: ManualLocalStoreRecord = {
    owner,
    repo,
    project_id,
    state: deepClone(sanitized),
    updated_at: now,
  };
  if (index === -1) {
    nextRecords.push(record);
  } else {
    nextRecords[index] = record;
  }
  setCache({ records: nextRecords });
  return { state: deepClone(record.state), updated_at: now };
}

export function deleteManualStateLocal(owner: string, repo: string, project_id: string): void {
  const current = ensureCache();
  const nextRecords = current.records.filter(
    (record) => !(record.owner === owner && record.repo === repo && record.project_id === project_id),
  );
  if (nextRecords.length === current.records.length) {
    return;
  }
  setCache({ records: deepClone(nextRecords) });
}

export function saveManualStateLocal(
  owner: string,
  repo: string,
  project_id: string,
  state: ManualState,
): { state: ManualState; updated_at: string | null } {
  const sanitized = sanitizeManualState(state);
  if (manualStateIsEmpty(sanitized)) {
    deleteManualStateLocal(owner, repo, project_id);
    return { state: {}, updated_at: null };
  }
  return upsertManualStateLocal(owner, repo, project_id, sanitized);
}

export function getManualStateStorePath(): string {
  return STORE_PATH;
}
