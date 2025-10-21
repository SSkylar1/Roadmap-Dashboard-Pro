import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import type { StandaloneRoadmapRecord } from "./roadmaps-store";
import type { StandaloneStatusSnapshot } from "./status-snapshots";

export type StandaloneStoresPayload = {
  roadmaps: StandaloneRoadmapRecord[];
  statusSnapshots: StandaloneStatusSnapshot[];
};

type StandaloneStoreUpdate = Partial<StandaloneStoresPayload>;

const DEFAULT_RELATIVE_PATH = ".roadmap-dashboard/standalone-store.json";
const STORE_PATH = resolve(
  process.cwd(),
  process.env.ROADMAP_DASHBOARD_STANDALONE_STORE_PATH ?? DEFAULT_RELATIVE_PATH,
);

let cache: StandaloneStoresPayload | null = null;

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

function normalizePayload(payload: any): StandaloneStoresPayload {
  const roadmaps = Array.isArray(payload?.roadmaps) ? payload.roadmaps : [];
  const statusSnapshots = Array.isArray(payload?.statusSnapshots)
    ? payload.statusSnapshots
    : [];
  return {
    roadmaps,
    statusSnapshots,
  };
}

function readFromDisk(): StandaloneStoresPayload {
  try {
    const raw = readFileSync(STORE_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    return normalizePayload(parsed);
  } catch (error) {
    return { roadmaps: [], statusSnapshots: [] };
  }
}

function writeToDisk(payload: StandaloneStoresPayload) {
  ensureDirectoryExists(STORE_PATH);
  const serialized = JSON.stringify(payload, null, 2);
  writeFileSync(STORE_PATH, `${serialized}\n`, "utf-8");
}

function ensureCache(): StandaloneStoresPayload {
  if (!cache) {
    cache = readFromDisk();
  }
  return cache;
}

export function loadStandaloneStores(): StandaloneStoresPayload {
  const current = ensureCache();
  return {
    roadmaps: deepClone(current.roadmaps),
    statusSnapshots: deepClone(current.statusSnapshots),
  };
}

export function saveStandaloneStores(update: StandaloneStoreUpdate): void {
  const current = ensureCache();
  const next: StandaloneStoresPayload = {
    roadmaps: deepClone(update.roadmaps ?? current.roadmaps),
    statusSnapshots: deepClone(update.statusSnapshots ?? current.statusSnapshots),
  };
  cache = next;
  writeToDisk(next);
}

export function getStandaloneStorePath(): string {
  return STORE_PATH;
}
