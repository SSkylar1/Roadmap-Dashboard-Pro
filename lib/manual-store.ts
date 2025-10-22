import { supabaseDelete, supabaseSelect, supabaseUpsert } from "./supabase-server";
import {
  ManualState,
  manualStateIsEmpty,
  normalizeOwner,
  normalizeProjectId,
  normalizeRepo,
  sanitizeManualState,
} from "./manual-state";
import {
  loadManualStateLocal,
  saveManualStateLocal,
} from "./manual-local-store";

const TABLE_NAME = "roadmap_manual_state";

export type ManualStateRow = {
  owner: string;
  repo: string;
  project_id: string;
  state: unknown;
  updated_at: string | null;
};

export type ManualStateResult = {
  available: boolean;
  state: ManualState;
  updated_at: string | null;
  storage: "supabase" | "local";
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

function isMissingTable(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false;
  const code = (error.code ?? "").toString();
  const message = error.message ?? "";
  if (code === "42P01") return true;
  const patterns = [/relation .* does not exist/i, /could not find the table/i, /schema cache/i];
  return patterns.some((pattern) => pattern.test(message));
}

function missingTableMessage(): string {
  return "Supabase table roadmap_manual_state not found. Apply the SQL in docs/supabase-roadmap-progress.sql to provision it.";
}

export async function loadManualState(
  owner: string | undefined,
  repo: string | undefined,
  project?: string | null,
): Promise<ManualStateResult> {
  const supabaseAvailable = supabaseConfigured();
  const ownerKey = normalizeOwner(owner);
  const repoKey = normalizeRepo(repo);
  const projectId = normalizeProjectId(project);
  if (!ownerKey || !repoKey) {
    return {
      available: true,
      state: {},
      updated_at: null,
      storage: supabaseAvailable ? "supabase" : "local",
    };
  }

  if (!supabaseAvailable) {
    const result = loadManualStateLocal(ownerKey, repoKey, projectId);
    return {
      available: true,
      state: result.state,
      updated_at: result.updated_at,
      storage: "local",
    };
  }

  const { data, error } = await supabaseSelect<ManualStateRow>(TABLE_NAME, "state,updated_at", {
    owner: `eq.${ownerKey}`,
    repo: `eq.${repoKey}`,
    project_id: `eq.${projectId}`,
  });

  if (error) {
    if (isMissingTable(error)) {
      throw new Error(missingTableMessage());
    }
    throw new Error(error.message || "Unexpected Supabase error");
  }

  const row = Array.isArray(data) && data.length > 0 ? data[0] : null;
  if (!row) {
    return { available: true, state: {}, updated_at: null, storage: "supabase" };
  }

  return {
    available: true,
    state: sanitizeManualState(row.state),
    updated_at: row.updated_at ?? null,
    storage: "supabase",
  };
}

export async function saveManualState(
  owner: string | undefined,
  repo: string | undefined,
  project: string | undefined | null,
  state: ManualState,
): Promise<ManualStateResult> {
  const supabaseAvailable = supabaseConfigured();
  const ownerKey = normalizeOwner(owner);
  const repoKey = normalizeRepo(repo);
  const projectId = normalizeProjectId(project);
  if (!ownerKey || !repoKey) {
    return {
      available: true,
      state: {},
      updated_at: null,
      storage: supabaseAvailable ? "supabase" : "local",
    };
  }

  if (!supabaseAvailable) {
    const result = saveManualStateLocal(ownerKey, repoKey, projectId, state);
    return {
      available: true,
      state: result.state,
      updated_at: result.updated_at,
      storage: "local",
    };
  }

  const sanitized = sanitizeManualState(state);
  if (manualStateIsEmpty(sanitized)) {
    const { error } = await supabaseDelete(TABLE_NAME, {
      owner: `eq.${ownerKey}`,
      repo: `eq.${repoKey}`,
      project_id: `eq.${projectId}`,
    });
    if (error) {
      if (isMissingTable(error)) {
        throw new Error(missingTableMessage());
      }
      throw new Error(error.message || "Unexpected Supabase error");
    }
    return { available: true, state: {}, updated_at: null, storage: "supabase" };
  }

  const now = new Date().toISOString();
  const { error } = await supabaseUpsert<ManualStateRow>(
    TABLE_NAME,
    [
      {
        owner: ownerKey,
        repo: repoKey,
        project_id: projectId,
        state: sanitized,
        updated_at: now,
      },
    ],
  );

  if (error) {
    if (isMissingTable(error)) {
      throw new Error(missingTableMessage());
    }
    throw new Error(error.message || "Unexpected Supabase error");
  }

  return { available: true, state: sanitized, updated_at: now, storage: "supabase" };
}
