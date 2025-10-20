import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

import { supabaseDelete, supabaseSelect, supabaseUpsert, type PostgrestErrorLike } from "./supabase-server";
import {
  EMPTY_STORE,
  normalizeSecretsForSave,
  sanitizeString,
  type RepoProjectSecrets,
  type RepoSecrets,
  type SecretsStore,
} from "./secrets";

const TABLE_NAME = "dashboard_secrets";
const ENCRYPTION_ALGORITHM = "aes-256-gcm";

function encodeChunk(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

type DashboardSecretRow = {
  composite_id: string;
  owner: string | null;
  repo: string | null;
  project_id: string | null;
  payload_encrypted: string;
};

function requireServiceRoleKey(): string {
  const key =
    process.env.SB_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SB_SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error("Missing SB_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_ROLE_KEY) env var");
  }
  return key;
}

function getEncryptionKey(): Buffer {
  const serviceKey = requireServiceRoleKey();
  return createHash("sha256").update(serviceKey).digest();
}

function handleTableError(error: PostgrestErrorLike): never {
  const code = error?.code ?? "";
  const message = error?.message ?? "";
  const missingTablePatterns = [/does not exist/i, /could not find the table/i, /schema cache/i];

  if (code === "42P01" || missingTablePatterns.some((pattern) => pattern.test(message))) {
    throw new Error(
      "Supabase table dashboard_secrets not found. Apply the SQL in docs/supabase-dashboard-secrets.sql to provision it.",
    );
  }
  throw new Error(message || "Unexpected Supabase error");
}

function encryptPayload(payload: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ENCRYPTION_ALGORITHM, getEncryptionKey(), iv);
  const serialized = Buffer.from(JSON.stringify(payload), "utf8");
  const encrypted = Buffer.concat([cipher.update(serialized), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${encodeChunk(iv)}.${encodeChunk(encrypted)}.${encodeChunk(authTag)}`;
}

function decryptPayload(token: string): unknown {
  const [ivEncoded, payloadEncoded, tagEncoded] = token.split(".");
  if (!ivEncoded || !payloadEncoded || !tagEncoded) {
    throw new Error("Invalid encrypted payload format");
  }
  const decipher = createDecipheriv(
    ENCRYPTION_ALGORITHM,
    getEncryptionKey(),
    Buffer.from(ivEncoded, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tagEncoded, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(payloadEncoded, "base64")),
    decipher.final(),
  ]);
  const text = decrypted.toString("utf8");
  return JSON.parse(text);
}

function createCompositeId(owner: string | null, repo: string | null, projectId: string | null): string {
  if (!owner && !repo && !projectId) {
    return "defaults";
  }
  if (!owner || !repo) {
    throw new Error("Owner and repo are required for repo/project secrets");
  }
  const repoKey = `${owner.toLowerCase()}/${repo.toLowerCase()}`;
  if (projectId) {
    return `project:${repoKey}:${projectId}`;
  }
  return `repo:${repoKey}`;
}

function flattenSecrets(store: SecretsStore): DashboardSecretRow[] {
  const rows: DashboardSecretRow[] = [];

  if (store.defaults && Object.keys(store.defaults).length) {
    rows.push({
      composite_id: createCompositeId(null, null, null),
      owner: null,
      repo: null,
      project_id: null,
      payload_encrypted: encryptPayload({ defaults: store.defaults }),
    });
  }

  for (const repo of store.repos) {
    rows.push({
      composite_id: createCompositeId(repo.owner, repo.repo, null),
      owner: repo.owner,
      repo: repo.repo,
      project_id: null,
      payload_encrypted: encryptPayload({
        id: repo.id,
        owner: repo.owner,
        repo: repo.repo,
        displayName: repo.displayName,
        supabaseReadOnlyUrl: repo.supabaseReadOnlyUrl,
        githubPat: repo.githubPat,
        openaiKey: repo.openaiKey,
      }),
    });

    for (const project of repo.projects) {
      rows.push({
        composite_id: createCompositeId(repo.owner, repo.repo, project.id),
        owner: repo.owner,
        repo: repo.repo,
        project_id: project.id,
        payload_encrypted: encryptPayload({
          id: project.id,
          repoId: repo.id,
          name: project.name,
          supabaseReadOnlyUrl: project.supabaseReadOnlyUrl,
          githubPat: project.githubPat,
          openaiKey: project.openaiKey,
        }),
      });
    }
  }

  return rows;
}

function encodeInFilter(values: string[]): string {
  const quoted = values.map((value) => `"${value.replace(/"/g, '\\"')}"`);
  return `in.(${quoted.join(",")})`;
}

function normalizeDefaults(defaults: SecretsStore["defaults"]): SecretsStore["defaults"] {
  return {
    ...(sanitizeString(defaults?.githubPat) ? { githubPat: sanitizeString(defaults.githubPat)! } : {}),
    ...(sanitizeString(defaults?.openaiKey) ? { openaiKey: sanitizeString(defaults.openaiKey)! } : {}),
    ...(sanitizeString(defaults?.supabaseReadOnlyUrl)
      ? { supabaseReadOnlyUrl: sanitizeString(defaults.supabaseReadOnlyUrl)! }
      : {}),
  };
}

function applyRepoPayload(row: DashboardSecretRow, payload: any, existing?: RepoSecrets): RepoSecrets {
  const owner = sanitizeString(payload?.owner) ?? sanitizeString(row.owner) ?? "";
  const repo = sanitizeString(payload?.repo) ?? sanitizeString(row.repo) ?? "";
  const id = sanitizeString(payload?.id) ?? (owner && repo ? `${owner.toLowerCase()}/${repo.toLowerCase()}` : "");
  const base: RepoSecrets = existing
    ? { ...existing, owner: existing.owner || owner, repo: existing.repo || repo }
    : {
        id,
        owner,
        repo,
        projects: [],
      };

  if (sanitizeString(payload?.displayName)) {
    base.displayName = sanitizeString(payload.displayName);
  }
  if (sanitizeString(payload?.supabaseReadOnlyUrl)) {
    base.supabaseReadOnlyUrl = sanitizeString(payload.supabaseReadOnlyUrl);
  }
  if (sanitizeString(payload?.githubPat)) {
    base.githubPat = sanitizeString(payload.githubPat);
  }
  if (sanitizeString(payload?.openaiKey)) {
    base.openaiKey = sanitizeString(payload.openaiKey);
  }

  if (!base.owner && row.owner) {
    base.owner = row.owner;
  }
  if (!base.repo && row.repo) {
    base.repo = row.repo;
  }
  if (!base.id && base.owner && base.repo) {
    base.id = `${base.owner.toLowerCase()}/${base.repo.toLowerCase()}`;
  }

  return base;
}

function applyProjectPayload(
  row: DashboardSecretRow,
  payload: any,
  repo: RepoSecrets,
  existing?: RepoProjectSecrets,
): RepoProjectSecrets {
  const id = sanitizeString(payload?.id) ?? sanitizeString(row.project_id) ?? "";
  const name = sanitizeString(payload?.name) ?? id;

  const base: RepoProjectSecrets = existing ? { ...existing } : { id, name: name ?? id };

  if (sanitizeString(payload?.name)) {
    base.name = sanitizeString(payload.name)!;
  }
  if (sanitizeString(payload?.supabaseReadOnlyUrl)) {
    base.supabaseReadOnlyUrl = sanitizeString(payload.supabaseReadOnlyUrl);
  }
  if (sanitizeString(payload?.githubPat)) {
    base.githubPat = sanitizeString(payload.githubPat);
  }
  if (sanitizeString(payload?.openaiKey)) {
    base.openaiKey = sanitizeString(payload.openaiKey);
  }

  if (!base.id) {
    base.id = sanitizeString(row.project_id) ?? `${repo.id}-project`;
  }
  if (!base.name) {
    base.name = base.id;
  }

  return base;
}

export async function persistSecrets(input: SecretsStore): Promise<SecretsStore> {
  const normalized = normalizeSecretsForSave(input);
  const rows = flattenSecrets(normalized);

  const { data: existingRows, error: existingError } = await supabaseSelect<{ composite_id: string }>(
    TABLE_NAME,
    "composite_id",
  );

  if (existingError) {
    handleTableError(existingError);
  }

  const nextIds = new Set(rows.map((row) => row.composite_id));
  const existingIds = (existingRows ?? []).map((row) => row.composite_id);
  const idsToDelete = existingIds.filter((id) => !nextIds.has(id));

  if (idsToDelete.length) {
    const filterValue = encodeInFilter(idsToDelete);
    const { error: deleteError } = await supabaseDelete(TABLE_NAME, { composite_id: filterValue });
    if (deleteError) {
      handleTableError(deleteError);
    }
  }

  if (rows.length) {
    const { error: upsertError } = await supabaseUpsert(TABLE_NAME, rows);
    if (upsertError) {
      handleTableError(upsertError);
    }
  }

  return normalized;
}

export async function loadSecrets(): Promise<SecretsStore> {
  const { data, error } = await supabaseSelect<DashboardSecretRow>(
    TABLE_NAME,
    "composite_id,owner,repo,project_id,payload_encrypted",
  );

  if (error) {
    handleTableError(error);
  }

  if (!data || !data.length) {
    return EMPTY_STORE;
  }

  const rows = [...data].sort((a, b) => {
    const ownerCompare = (a.owner ?? "").localeCompare(b.owner ?? "");
    if (ownerCompare !== 0) return ownerCompare;
    const repoCompare = (a.repo ?? "").localeCompare(b.repo ?? "");
    if (repoCompare !== 0) return repoCompare;
    return (a.project_id ?? "").localeCompare(b.project_id ?? "");
  });

  let defaults: SecretsStore["defaults"] = {};
  const repoMap = new Map<string, RepoSecrets>();

  for (const row of rows) {
    if (!row.payload_encrypted) {
      continue;
    }

    const payload = decryptPayload(row.payload_encrypted);

    if (row.composite_id === "defaults") {
      const defaultsPayload = (payload as { defaults?: SecretsStore["defaults"] })?.defaults ?? (payload as any);
      defaults = normalizeDefaults(defaultsPayload ?? {});
      continue;
    }

    if (!row.owner || !row.repo) {
      continue;
    }

    if (!row.project_id) {
      const repoKey = createCompositeId(row.owner, row.repo, null);
      const repoId = repoKey.replace(/^repo:/, "");
      const existing = repoMap.get(repoId);
    const repoEntry = applyRepoPayload(row, payload, existing);
    repoMap.set(repoEntry.id, { ...repoEntry, projects: existing?.projects ?? repoEntry.projects ?? [] });
    }
  }

  for (const row of rows) {
    if (!row.payload_encrypted || !row.project_id || !row.owner || !row.repo) {
      continue;
    }

    const payload = decryptPayload(row.payload_encrypted) as { repoId?: string };
    const repoId = sanitizeString(payload?.repoId) ?? `${row.owner.toLowerCase()}/${row.repo.toLowerCase()}`;
    const existingRepo = repoMap.get(repoId) ?? {
      id: repoId,
      owner: row.owner,
      repo: row.repo,
      projects: [],
    };

    const projectExisting = existingRepo.projects.find((project) => project.id === row.project_id);
    const projectEntry = applyProjectPayload(row, payload, existingRepo, projectExisting);

    const nextProjects = projectExisting
      ? existingRepo.projects.map((project) => (project.id === projectEntry.id ? projectEntry : project))
      : [...existingRepo.projects, projectEntry];

    repoMap.set(repoId, { ...existingRepo, projects: nextProjects });
  }

  const store: SecretsStore = {
    defaults,
    repos: Array.from(repoMap.values()),
  };

  return normalizeSecretsForSave(store);
}
