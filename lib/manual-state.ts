import { normalizeProjectKey } from "./project-paths";

export type ManualItem = {
  key: string;
  name: string;
  note?: string;
  done?: boolean;
};

export type ManualWeekState = {
  added: ManualItem[];
  removed: string[];
};

export type ManualState = Record<string, ManualWeekState>;

export function sanitizeManualState(value: unknown): ManualState {
  const safe: ManualState = {};
  if (!value || typeof value !== "object") return safe;

  for (const [weekKey, rawWeek] of Object.entries(value as Record<string, unknown>)) {
    if (typeof weekKey !== "string" || !weekKey.trim()) continue;
    const weekValue = rawWeek as Partial<ManualWeekState>;
    const addedRaw = Array.isArray(weekValue?.added) ? weekValue.added : [];
    const removedRaw = Array.isArray(weekValue?.removed) ? weekValue.removed : [];
    const added = addedRaw.reduce<ManualItem[]>((list, entry) => {
      if (!entry || typeof entry !== "object") return list;
      const item = entry as ManualItem;
      const key = typeof item.key === "string" ? item.key.trim() : null;
      const name = typeof item.name === "string" ? item.name.trim() : null;
      if (!key || !name) return list;
      const note = typeof item.note === "string" ? item.note : undefined;
      const done = typeof item.done === "boolean" ? item.done : undefined;
      list.push({ key, name, note, done });
      return list;
    }, []);
    const removed = removedRaw
      .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
      .filter((entry) => entry.length > 0);

    if (added.length > 0 || removed.length > 0) {
      safe[weekKey] = { added, removed };
    }
  }

  return safe;
}

export function manualStateIsEmpty(state: ManualState): boolean {
  return Object.keys(state).length === 0;
}

export function normalizeOwner(value: string | undefined | null): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function normalizeRepo(value: string | undefined | null): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function normalizeProjectId(project?: string | null): string {
  const key = normalizeProjectKey(project ?? undefined);
  return key ?? "";
}
