"use client";

import Link from "next/link";
import {
  Suspense,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { ROADMAP_CHECKER_SNIPPET } from "@/lib/roadmap-snippets";
import { WIZARD_ENTRY_POINTS, type WizardEntryPoint } from "@/lib/wizard-entry-points";
import { useLocalSecrets } from "@/lib/use-local-secrets";

type Check = {
  id?: string;
  name?: string;
  type: string;
  ok?: boolean;
  detail?: string;
  note?: string;
  status?: string;
  result?: string;
  globs?: string[];
  url?: string;
  must_match?: string[];
  query?: string;
};

type Item = {
  id?: string;
  name?: string;
  checks?: Check[];
  done?: boolean;
  note?: string;
  manual?: boolean;
  manualKey?: string;
};

type Week = {
  id?: string;
  title?: string;
  items?: Item[];
};

type StatusResponse = {
  generated_at?: string;
  env?: string;
  weeks: Week[];
};

type RepoRef = {
  owner: string;
  repo: string;
  label?: string;
};

type ManualItem = {
  key: string;
  name: string;
  note?: string;
  done?: boolean;
};

type ManualWeekState = {
  added: ManualItem[];
  removed: string[];
};

type ManualState = Record<string, ManualWeekState>;

type DecoratedItem = Item & { manualKey?: string; manual?: boolean };
type DecoratedWeek = Week & { manualKey: string; manualState: ManualWeekState; items?: DecoratedItem[] };

type GtmPlanTabProps = {
  repo: RepoRef | null;
};

type CommitApiResponse = {
  ok?: boolean;
  content?: string;
  created?: boolean;
  error?: string;
};

type TabKey = "projects" | "gtm" | "onboarding" | "add";

const DEFAULT_REPOS: RepoRef[] = [{ owner: "SSkylar1", repo: "Roadmap-Kit-Starter" }];
const REPO_STORAGE_KEY = "roadmap-dashboard.repos";
const MANUAL_STORAGE_PREFIX = "roadmap-dashboard.manual.";
const TAB_LABELS: Record<TabKey, string> = {
  projects: "Projects",
  gtm: "GTM Plan",
  onboarding: "Onboarding Checklist",
  add: "Add New Project",
};
const TAB_KEYS: TabKey[] = ["projects", "gtm", "onboarding", "add"];

function normalizeTab(value: string | null): TabKey {
  if (value === "gtm" || value === "onboarding" || value === "add") return value;
  return "projects";
}

const EDGE_FUNCTION_SNIPPET = [
  "import { Pool, type PoolClient } from \"https://deno.land/x/postgres@v0.17.0/mod.ts\";",
  "",
  "const corsHeaders = {",
  "  \"Access-Control-Allow-Origin\": \"*\",",
  "  \"Access-Control-Allow-Headers\": \"authorization, x-client-info, apikey, content-type\",",
  "};",
  "",
  "const connectionString =",
  "  Deno.env.get(\"SB_DB_URL\") ??",
  "  Deno.env.get(\"SUPABASE_DB_URL\") ??",
  "  Deno.env.get(\"DATABASE_URL\");",
  "",
  "if (!connectionString) {",
  "  throw new Error(\"Set the SB_DB_URL (or SUPABASE_DB_URL) secret before deploying this function.\");",
  "}",
  "",
  "const pool = new Pool(connectionString, 1, true);",
  "const READ_ROLES = [\"anon\", \"authenticated\"];",
  "const READ_ROLES_SQL = READ_ROLES.map((role) => \"'\" + role + \"'\").join(\", \");",
  "const allowed = /^(ext:[a-z0-9_]+|table:[a-z0-9_]+:[a-z0-9_]+|rls:[a-z0-9_]+:[a-z0-9_]+|policy:[a-z0-9_]+:[a-z0-9_]+:[^:]+)$/i;",
  "",
  "function pickSymbol(payload: unknown): string | null {",
  "  if (!payload) return null;",
  "  if (typeof payload === \"string\") return payload;",
  "  if (Array.isArray(payload)) {",
  "    for (const entry of payload) {",
  "      const candidate = pickSymbol(entry);",
  "      if (candidate) return candidate;",
  "    }",
  "    return null;",
  "  }",
  "  if (typeof payload === \"object\") {",
  "    const record = payload as Record<string, unknown>;",
  "    const direct = [record.query, record.symbol, record.q];",
  "    for (const entry of direct) {",
  "      if (typeof entry === \"string\") return entry;",
  "    }",
  "    const multi = [record.queries, record.symbols];",
  "    for (const entry of multi) {",
  "      if (!entry) continue;",
  "      if (typeof entry === \"string\") return entry;",
  "      if (Array.isArray(entry)) {",
  "        for (const value of entry) {",
  "          const candidate = pickSymbol(value);",
  "          if (candidate) return candidate;",
  "        }",
  "        continue;",
  "      }",
  "      const candidate = pickSymbol(entry);",
  "      if (candidate) return candidate;",
  "    }",
  "    const nestedKeys = [\"result\", \"results\", \"data\", \"payload\"];",
  "    for (const key of nestedKeys) {",
  "      const candidate = pickSymbol(record[key]);",
  "      if (candidate) return candidate;",
  "    }",
  "  }",
  "  return null;",
  "}",
  "",
  "async function withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {",
  "  const client = await pool.connect();",
  "  try {",
  "    return await fn(client);",
  "  } finally {",
  "    client.release();",
  "  }",
  "}",
  "",
  "async function checkExtension(ext: string): Promise<boolean> {",
  "  const result = await withClient((client) =>",
  "    client.queryObject<{ exists: boolean }>(",
  "      \"select exists(select 1 from pg_extension where extname = $1) as exists\",",
  "      ext,",
  "    )",
  "  );",
  "  return result.rows[0]?.exists ?? false;",
  "}",
  "",
  "async function checkTable(schema: string, table: string): Promise<boolean> {",
  "  const sql =",
  "    \"select coalesce(bool_or(privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE')), false) as has_write \" +",
  "    \"from information_schema.role_table_grants where table_schema = $1 and table_name = $2 and grantee in (\" +",
  "    READ_ROLES_SQL +",
  "    \")\";",
  "  const result = await withClient((client) => client.queryObject<{ has_write: boolean }>(sql, schema, table));",
  "  return !(result.rows[0]?.has_write ?? false);",
  "}",
  "",
  "async function checkRls(schema: string, table: string): Promise<boolean> {",
  "  const identifier = schema + \".\" + table;",
  "  const result = await withClient((client) =>",
  "    client.queryObject<{ enabled: boolean }>(",
  "      \"select relrowsecurity as enabled from pg_class where oid = to_regclass($1)\",",
  "      identifier,",
  "    )",
  "  );",
  "  return result.rows[0]?.enabled ?? false;",
  "}",
  "",
  "async function checkPolicy(schema: string, table: string, policy: string): Promise<boolean> {",
  "  const result = await withClient((client) =>",
  "    client.queryObject<{ count: number }>(",
  "      \"select count(*)::int as count from pg_policies where schemaname = $1 and tablename = $2 and policyname = $3 and command = 'SELECT'\",",
  "      schema,",
  "      table,",
  "      policy,",
  "    )",
  "  );",
  "  return (result.rows[0]?.count ?? 0) > 0;",
  "}",
  "",
  "async function runCheck(symbol: string): Promise<boolean> {",
  "  const parts = symbol.split(\":\");",
  "  const kind = parts[0];",
  "  if (kind === \"ext\" && parts.length === 2) return checkExtension(parts[1]);",
  "  if (kind === \"table\" && parts.length === 3) return checkTable(parts[1], parts[2]);",
  "  if (kind === \"rls\" && parts.length === 3) return checkRls(parts[1], parts[2]);",
  "  if (kind === \"policy\" && parts.length === 4) return checkPolicy(parts[1], parts[2], parts[3]);",
  "  return false;",
  "}",
  "",
  "Deno.serve(async (req) => {",
  "  if (req.method === \"OPTIONS\") {",
  "    return new Response(null, { status: 204, headers: corsHeaders });",
  "  }",
  "",
  "  const url = new URL(req.url);",
  "",
  "  if (req.method === \"GET\" && url.pathname === \"/_health\") {",
  "    return new Response(JSON.stringify({ ok: true }), {",
  "      status: 200,",
  "      headers: Object.assign({ \"Content-Type\": \"application/json\" }, corsHeaders),",
  "    });",
  "  }",
  "",
  "  if (req.method !== \"POST\") {",
  "    return new Response(\"Method Not Allowed\", { status: 405, headers: corsHeaders });",
  "  }",
  "",
  "  let body: unknown;",
  "  try {",
  "    body = await req.json();",
  "  } catch {",
  "    return new Response(JSON.stringify({ ok: false, error: \"invalid payload\" }), {",
  "      status: 400,",
  "      headers: Object.assign({ \"Content-Type\": \"application/json\" }, corsHeaders),",
  "    });",
  "  }",
  "",
  "  const symbol = pickSymbol(body);",
  "  if (typeof symbol !== \"string\" || !allowed.test(symbol)) {",
  "    return new Response(JSON.stringify({ ok: false, error: \"invalid symbol\" }), {",
  "      status: 400,",
  "      headers: Object.assign({ \"Content-Type\": \"application/json\" }, corsHeaders),",
  "    });",
  "  }",
  "",
  "  try {",
  "    const ok = await runCheck(symbol);",
  "    return new Response(JSON.stringify({ ok }), {",
  "      status: 200,",
  "      headers: Object.assign({ \"Content-Type\": \"application/json\" }, corsHeaders),",
  "    });",
  "  } catch (error) {",
  "    console.error(error);",
  "    return new Response(JSON.stringify({ ok: false, error: \"check failed\" }), {",
  "      status: 500,",
  "      headers: Object.assign({ \"Content-Type\": \"application/json\" }, corsHeaders),",
  "    });",
  "  }",
  "});",
].join("\n");

const EDGE_FUNCTION_COMMANDS = [
  "# Authenticate Supabase CLI and link your project",
  "supabase login",
  "supabase link --project-ref <project-ref>",
  "",
  "# Scaffold the edge function (creates supabase/functions/read_only_checks)",
  "supabase functions new read_only_checks --no-verify-jwt",
  "",
  "# Store the Postgres connection string as a secret for deploys",
  "supabase secrets set SB_DB_URL=\"postgresql://postgres:<db-password>@db.<project-ref>.supabase.co:5432/postgres\" SUPABASE_DB_URL=\"postgresql://postgres:<db-password>@db.<project-ref>.supabase.co:5432/postgres\"",
  "",
  "# Optional: run locally once you add SB_DB_URL (or SUPABASE_DB_URL) to supabase/.env",
  "supabase functions serve read_only_checks --env-file supabase/.env",
  "",
  "# Deploy and smoke test from the CLI",
  "supabase functions deploy read_only_checks --no-verify-jwt",
  "supabase functions list",
  "supabase secrets list",
  "supabase functions invoke read_only_checks --project-ref <project-ref> --no-verify-jwt --body '{\"queries\":[\"ext:pgcrypto\"]}'",
].join("\n");

const EDGE_FUNCTION_CURL = [
  "curl -X POST https://<project-ref>.functions.supabase.co/read_only_checks \\",
  "  -H \"Content-Type: application/json\" \\",
  "  -d '{\"queries\":[\"ext:pgcrypto\"]}'",
].join("\n");

const ROADMAP_YAML_SNIPPET = [
  "version: 1",
  "weeks:",
  "  - id: w01",
  "    title: \"Weeks 1–2 — Foundations\"",
  "    items:",
  "      - id: infra-ci",
  "        name: \"CI & status scaffolding\"",
  "        checks:",
  "          - type: files_exist",
  "            globs: ['.github/workflows/roadmap.yml']",
  "          - type: http_ok",
  "            url: \"https://api.github.com/rate_limit\"",
  "            must_match: ['resources']",
  "  - id: w02",
  "    title: \"Weeks 3–4 — Auth & DB\"",
  "    items:",
  "      - id: db-ext",
  "        name: \"Required extension enabled\"",
  "        checks:",
  "          - type: sql_exists",
  "            query: \"ext:pgcrypto\"",
].join("\n");

const PACKAGE_JSON_SNIPPET = [
  "\"scripts\": {",
  "  \"roadmap:check\": \"node scripts/roadmap-check.mjs\"",
  "}",
].join("\n");

const WORKFLOW_STEP_SNIPPET = [
  "- name: Run roadmap checks",
  "  env:",
  "    READ_ONLY_CHECKS_URL: ${{ secrets.READ_ONLY_CHECKS_URL }}",
  "  run: node scripts/roadmap-check.mjs",
].join("\n");

const NPM_INSTALL_SNIPPET = "npm install --save-dev js-yaml";

const SECRET_SNIPPET =
  "READ_ONLY_CHECKS_URL=https://<your-supabase-ref>.functions.supabase.co/read_only_checks";

const GITHUB_APP_ENV_SNIPPET = [
  "GH_APP_ID=<your-app-id>",
  'GH_APP_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\\n..."',
  "# optional if you want to pin a specific installation",
  "GH_APP_INSTALLATION_ID=<installation-id>",
].join("\n");

const enum CopyState {
  Idle = "idle",
  Copied = "copied",
  Error = "error",
}

function repoKey(owner: string, repo: string) {
  return `${owner.trim().toLowerCase()}/${repo.trim().toLowerCase()}`;
}

function normalizeRepoRef(ref: Partial<RepoRef> | RepoRef): RepoRef {
  const owner = typeof ref?.owner === "string" ? ref.owner.trim() : "";
  const repo = typeof ref?.repo === "string" ? ref.repo.trim() : "";
  const label = typeof ref?.label === "string" ? ref.label.trim() : undefined;
  return { owner, repo, label };
}

function sanitizeManualState(value: unknown): ManualState {
  const safe: ManualState = {};
  if (!value || typeof value !== "object") return safe;

  for (const [weekKey, rawWeek] of Object.entries(value as Record<string, unknown>)) {
    if (typeof weekKey !== "string") continue;
    const weekValue = rawWeek as Partial<ManualWeekState>;
    const addedRaw = Array.isArray(weekValue?.added) ? weekValue.added : [];
    const removedRaw = Array.isArray(weekValue?.removed) ? weekValue.removed : [];
    const added = addedRaw.reduce<ManualItem[]>((list, entry) => {
      if (!entry || typeof entry !== "object") return list;
      const item = entry as ManualItem;
      const key = typeof item.key === "string" ? item.key : null;
      const name = typeof item.name === "string" ? item.name : null;
      if (!key || !name) return list;
      const note = typeof item.note === "string" ? item.note : undefined;
      const done = typeof item.done === "boolean" ? item.done : undefined;
      list.push({ key, name, note, done });
      return list;
    }, []);
    const removed = removedRaw.filter((entry): entry is string => typeof entry === "string");

    if (added.length > 0 || removed.length > 0) {
      safe[weekKey] = { added, removed };
    }
  }

  return safe;
}

function getWeekKey(week: Week, index: number) {
  return week.id || week.title || `week-${index + 1}`;
}

function getItemKey(item: Item, index: number) {
  return item.id || item.name || `item-${index + 1}`;
}

function useStatus(owner: string, repo: string) {
  const [data, setData] = useState<StatusResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

  useEffect(() => {
    if (!owner || !repo) {
      setData(null);
      setErr(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    const url = `/api/status/${owner}/${repo}`;

    setLoading(true);
    fetch(url, { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          const msg = body?.message || body?.error || r.statusText || "Failed to load status";
          throw new Error(msg);
        }
        return r.json();
      })
      .then((json: StatusResponse) => {
        if (!cancelled) {
          setData(json);
          setErr(null);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setErr(String(e?.message || e));
          setData(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [owner, repo]);

  return { data, err, loading };
}

function useStoredRepos() {
  const [repos, setRepos] = useState<RepoRef[]>(DEFAULT_REPOS);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(REPO_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          const sanitized = parsed
            .map((value) => normalizeRepoRef(value as Partial<RepoRef>))
            .filter((value) => value.owner && value.repo);
          if (sanitized.length > 0) {
            setRepos(sanitized);
          }
        }
      }
    } catch {
      // ignore corrupt storage
    } finally {
      setInitialized(true);
    }
  }, []);

  const setAndStore = useCallback((updater: (prev: RepoRef[]) => RepoRef[]) => {
    setRepos((prev) => {
      const next = updater(prev);
      if (typeof window !== "undefined") {
        if (next.length === 0) {
          window.localStorage.removeItem(REPO_STORAGE_KEY);
        } else {
          window.localStorage.setItem(REPO_STORAGE_KEY, JSON.stringify(next));
        }
      }
      return next;
    });
  }, []);

  const addRepo = useCallback(
    (repo: RepoRef): RepoRef | null => {
      const normalized = normalizeRepoRef(repo);
      if (!normalized.owner || !normalized.repo) return null;
      const key = repoKey(normalized.owner, normalized.repo);

      setAndStore((prev) => {
        const idx = prev.findIndex((entry) => repoKey(entry.owner, entry.repo) === key);
        if (idx >= 0) {
          const next = [...prev];
          const existing = next[idx];
          next.splice(idx, 1);
          next.unshift({ ...existing, ...normalized });
          return next;
        }
        return [normalized, ...prev];
      });

      return normalized;
    },
    [setAndStore]
  );

  const removeRepo = useCallback(
    (repo: RepoRef) => {
      const normalized = normalizeRepoRef(repo);
      if (!normalized.owner || !normalized.repo) return;
      const key = repoKey(normalized.owner, normalized.repo);
      setAndStore((prev) => prev.filter((entry) => repoKey(entry.owner, entry.repo) !== key));
    },
    [setAndStore]
  );

  return { repos, initialized, addRepo, removeRepo };
}

function useManualRoadmap(owner?: string, repo?: string) {
  const storageKey = owner && repo ? `${MANUAL_STORAGE_PREFIX}${repoKey(owner, repo)}` : null;
  const [state, setState] = useState<ManualState>({});
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!storageKey) {
      setState({});
      setReady(false);
      return;
    }
    if (typeof window === "undefined") return;

    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        setState(sanitizeManualState(parsed));
      } else {
        setState({});
      }
    } catch {
      setState({});
    }
    setReady(true);
  }, [storageKey]);

  const setAndStore = useCallback(
    (updater: (prev: ManualState) => ManualState) => {
      if (!storageKey) return;
      setState((prev) => {
        const next = updater(prev);
        if (typeof window !== "undefined") {
          if (Object.keys(next).length === 0) {
            window.localStorage.removeItem(storageKey);
          } else {
            window.localStorage.setItem(storageKey, JSON.stringify(next));
          }
        }
        return next;
      });
    },
    [storageKey]
  );

  const addManualItem = useCallback(
    (weekKey: string, payload: { name: string; note?: string }) => {
      if (!storageKey) return;
      const trimmedName = payload.name.trim();
      if (!trimmedName) return;
      const trimmedNote = payload.note?.trim() || undefined;

      const manualItem: ManualItem = {
        key: `manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: trimmedName,
        note: trimmedNote,
      };

      setAndStore((prev) => {
        const current = prev[weekKey] ?? { added: [], removed: [] };
        const nextWeek: ManualWeekState = {
          added: [...current.added, manualItem],
          removed: current.removed,
        };
        return { ...prev, [weekKey]: nextWeek };
      });
    },
    [setAndStore, storageKey]
  );

  const removeManualItem = useCallback(
    (weekKey: string, manualKey: string) => {
      if (!storageKey) return;
      setAndStore((prev) => {
        const current = prev[weekKey];
        if (!current) return prev;
        const nextAdded = current.added.filter((item) => item.key !== manualKey);
        const nextWeek: ManualWeekState = { added: nextAdded, removed: current.removed };
        const next = { ...prev };
        if (nextWeek.added.length === 0 && nextWeek.removed.length === 0) {
          delete next[weekKey];
        } else {
          next[weekKey] = nextWeek;
        }
        return next;
      });
    },
    [setAndStore, storageKey]
  );

  const hideExistingItem = useCallback(
    (weekKey: string, itemKey: string) => {
      if (!storageKey || !itemKey) return;
      setAndStore((prev) => {
        const current = prev[weekKey] ?? { added: [], removed: [] };
        if (current.removed.includes(itemKey)) return prev;
        const nextWeek: ManualWeekState = {
          added: current.added,
          removed: [...current.removed, itemKey],
        };
        return { ...prev, [weekKey]: nextWeek };
      });
    },
    [setAndStore, storageKey]
  );

  const resetWeek = useCallback(
    (weekKey: string) => {
      if (!storageKey) return;
      setAndStore((prev) => {
        if (!prev[weekKey]) return prev;
        const next = { ...prev };
        delete next[weekKey];
        return next;
      });
    },
    [setAndStore, storageKey]
  );

  const resetAll = useCallback(() => {
    if (!storageKey) return;
    setState({});
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(storageKey);
    }
  }, [storageKey]);

  return { state, ready, addManualItem, removeManualItem, hideExistingItem, resetWeek, resetAll };
}

function statusIcon(ok: boolean | undefined) {
  if (ok === true) return "✅";
  if (ok === false) return "❌";
  return "⏳";
}

function statusTone(ok: boolean | undefined, hasChecks: boolean) {
  if (ok === true) return "success";
  if (ok === false) return "fail";
  return hasChecks ? "pending" : "neutral";
}

function statusText(ok: boolean | undefined, hasChecks: boolean) {
  if (ok === true) return "Complete";
  if (ok === false) return "Needs attention";
  return hasChecks ? "In progress" : "No checks yet";
}

function formatResultLabel(result: unknown) {
  if (typeof result !== "string") return null;
  const trimmed = result.trim();
  if (!trimmed) return null;
  return trimmed
    .split(/[_\s]+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function itemTitle(item: Item) {
  const title = typeof item.name === "string" && item.name.trim() ? item.name.trim() : null;
  const id = typeof item.id === "string" && item.id.trim() ? item.id.trim() : null;
  if (title) return { title, meta: id && id !== title ? id : null };
  if (id) return { title: id, meta: null };
  return { title: "Untitled item", meta: null };
}

function weekTitle(week: Week | undefined) {
  if (!week) return { title: "Untitled week", meta: null };
  const title = typeof week.title === "string" && week.title.trim() ? week.title.trim() : null;
  const id = typeof week.id === "string" && week.id.trim() ? week.id.trim() : null;
  if (title) return { title, meta: id && id !== title ? id : null };
  if (id) return { title: id, meta: null };
  return { title: "Untitled week", meta: null };
}

function friendlyCheckResult(check: Check) {
  const label = formatResultLabel(check.result ?? check.status);
  if (label) return label;
  if (check.ok === true) return "Complete";
  if (check.ok === false) return "Failed";
  return "Pending";
}

function checkLabel(check: Check) {
  return check.name || check.id || check.type || "Check";
}

function checkDetail(check: Check) {
  const detail = check.detail ?? check.note;
  return typeof detail === "string" && detail.trim() ? detail.trim() : null;
}

function incompleteChecks(checks?: Check[]) {
  return (checks ?? []).filter((c) => c.ok !== true);
}

function buildCheckSummary(check: Check) {
  const label = checkLabel(check);
  const status = friendlyCheckResult(check);
  const detail = checkDetail(check);
  const parts = [status];
  if (detail) parts.push(detail);
  return `${label}${parts.length ? ` — ${parts.join(" • ")}` : ""}`;
}

function buildItemCopyText(item: Item, week?: Week) {
  const { title: itemHeading, meta: itemMeta } = itemTitle(item);
  const { title: weekHeading, meta: weekMeta } = weekTitle(week);
  const weekPart = weekHeading ? `${weekHeading}${weekMeta ? ` (${weekMeta})` : ""}` : null;
  const itemPart = `${itemHeading}${itemMeta ? ` (${itemMeta})` : ""}`;

  const lines: string[] = [weekPart ? `${weekPart} — ${itemPart}` : itemPart];
  const checks = item.checks ?? [];
  const hasChecks = checks.length > 0;
  const status = itemStatus(item);
  lines.push(`Status: ${statusText(status, hasChecks)}`);

  const blockers = incompleteChecks(checks);
  if (hasChecks && blockers.length > 0) {
    lines.push("Blocked by:");
    blockers.forEach((chk) => {
      lines.push(`- ${buildCheckSummary(chk)}`);
    });
  } else if (!hasChecks) {
    lines.push("Blocked by: No checks configured yet.");
  } else {
    lines.push("Blocked by: None");
  }

  return lines.join("\n");
}

type IncompleteEntry = {
  key: string;
  week: Week;
  item: Item;
  summary: string;
  statusLabel: string;
  weekLabel: string;
  itemLabel: string;
  itemMeta?: string | null;
  blockers: string[];
};

function collectChecks(status: StatusResponse | null): Check[] {
  if (!status) return [];
  const checks: Check[] = [];
  for (const week of status.weeks ?? []) {
    for (const item of week.items ?? []) {
      for (const check of item.checks ?? []) {
        checks.push(check);
      }
    }
  }
  return checks;
}

function collectIncompleteEntries(weeks: Week[]): IncompleteEntry[] {
  const entries: IncompleteEntry[] = [];
  for (const week of weeks) {
    const { title: wTitle, meta: wMeta } = weekTitle(week);
    for (const item of week.items ?? []) {
      const status = itemStatus(item);
      const checks = item.checks ?? [];
      const hasChecks = checks.length > 0;
      if (status === true) continue;
      const { title: itemHeading, meta: itemMeta } = itemTitle(item);
      const blockers = hasChecks
        ? incompleteChecks(checks).map((chk) => buildCheckSummary(chk))
        : ["No checks configured yet."];
      entries.push({
        key: `${week.id ?? wTitle ?? "week"}::${item.id ?? itemHeading}`,
        week,
        item,
        summary: buildItemCopyText(item, week),
        statusLabel: statusText(status, hasChecks),
        weekLabel: wMeta ? `${wTitle} (${wMeta})` : wTitle,
        itemLabel: itemHeading,
        itemMeta,
        blockers,
      });
    }
  }
  return entries;
}

function buildOverallCopyText(entries: IncompleteEntry[]) {
  if (entries.length === 0) return "All roadmap items are complete!";
  const lines: string[] = [`Incomplete roadmap items (${entries.length}):`];
  entries.forEach((entry, index) => {
    const count = index + 1;
    const meta = entry.itemMeta ? ` (${entry.itemMeta})` : "";
    const weekPrefix = entry.weekLabel ? `${entry.weekLabel} — ` : "";
    lines.push(`${count}. ${weekPrefix}${entry.itemLabel}${meta}`);
    lines.push(`   Status: ${entry.statusLabel}`);
    entry.blockers.forEach((blocker) => {
      lines.push(`   - ${blocker}`);
    });
  });
  return lines.join("\n");
}

type StatusCounts = {
  total: number;
  passed: number;
  failed: number;
  pending: number;
};

function summarizeChecks(checks?: Check[]): StatusCounts {
  const total = checks?.length ?? 0;
  const passed = (checks ?? []).filter((c) => c.ok === true).length;
  const failed = (checks ?? []).filter((c) => c.ok === false).length;
  const pending = total - passed - failed;
  return { total, passed, failed, pending };
}

function formatStatusSummary({ total, passed, failed, pending }: StatusCounts) {
  if (total === 0) return null;
  const parts: string[] = [];
  if (passed > 0) parts.push(`✅ ${passed}`);
  if (failed > 0) parts.push(`❌ ${failed}`);
  if (pending > 0) parts.push(`⏳ ${pending}`);

  if (parts.length === 0) return null;
  return `${parts.join(" • ")}${total > 0 ? ` (of ${total})` : ""}`;
}

function checksStatus(checks?: Check[]): boolean | undefined {
  const arr = checks ?? [];
  if (arr.length === 0) return undefined;
  let pending = false;
  for (const c of arr) {
    if (c.ok === false) return false;
    if (c.ok !== true) pending = true;
  }
  if (pending) return undefined;
  return true;
}

function itemStatus(item: Item): boolean | undefined {
  if (typeof item.done === "boolean") return item.done;
  return checksStatus(item.checks);
}

function weekStatus(week: Week): boolean | undefined {
  const items = week.items ?? [];
  if (items.length === 0) return undefined;
  let pending = false;
  for (const it of items) {
    const st = itemStatus(it);
    if (st === false) return false;
    if (st !== true) pending = true;
  }
  if (pending) return undefined;
  return true;
}

function StatusBadge({
  ok,
  total,
  summary,
}: {
  ok: boolean | undefined;
  total: number;
  summary: string | null;
}) {
  const tone = statusTone(ok, total > 0);
  const label = summary ?? statusText(ok, total > 0);
  return (
    <span className={`status-chip status-${tone}`}>
      <span className="status-chip-icon">{statusIcon(ok)}</span>
      <span className="status-chip-text">{label}</span>
    </span>
  );
}

function WeekProgress({ weeks }: { weeks: Week[] }) {
  const { total, passed, failed, pending } = useMemo(() => {
    let total = 0,
      passed = 0,
      failed = 0,
      pending = 0;
    for (const w of weeks) {
      for (const it of w.items ?? []) {
        const s = summarizeChecks(it.checks);
        total += s.total;
        passed += s.passed;
        failed += s.failed;
        pending += s.pending;
      }
    }
    return { total, passed, failed, pending };
  }, [weeks]);

  if (total === 0) return null;

  const pct = (n: number) => Math.round((n / total) * 100);

  const summary = formatStatusSummary({ total, passed, failed, pending });
  const overallStatus = failed > 0 ? false : pending > 0 ? undefined : true;

  return (
    <div className="progress-card">
      <div className="status-row">
        <div className="section-title">Overall Progress</div>
        <StatusBadge ok={overallStatus} total={total} summary={summary} />
      </div>
      <div className="progress-bar" role="presentation">
        <div className="progress-fill passed" style={{ width: `${pct(passed)}%` }} title={`Passed: ${passed}`} />
        <div className="progress-fill failed" style={{ width: `${pct(failed)}%` }} title={`Failed: ${failed}`} />
        <div className="progress-fill pending" style={{ width: `${pct(pending)}%` }} title={`Pending: ${pending}`} />
      </div>
      <div className="progress-legend">
        ✅ {passed} · ❌ {failed} · ⏳ {pending}
      </div>
    </div>
  );
}

function CheckRow({ c }: { c: Check }) {
  const label = c.name || c.id || c.type || "Check";
  const detail = c.detail ?? c.note ?? null;
  const resultLabel = formatResultLabel(c.result ?? c.status);
  const tone = statusTone(c.ok, true);
  return (
    <li className={`subtask subtask-${tone}`}>
      <div className="subtask-info">
        <div className="subtask-label">{label}</div>
        {detail ? <div className="subtask-detail">{detail}</div> : null}
      </div>
      <div className="subtask-status">
        <span className={`status-chip status-${tone}`}>
          <span className="status-chip-icon">{statusIcon(c.ok)}</span>
          {resultLabel ? <span className="status-chip-text">{resultLabel}</span> : null}
        </span>
      </div>
    </li>
  );
}

function ItemCard({
  item,
  week,
  onDelete,
  allowDelete,
}: {
  item: DecoratedItem;
  week: DecoratedWeek;
  onDelete?: () => void;
  allowDelete: boolean;
}) {
  const sum = summarizeChecks(item.checks);
  const summary = formatStatusSummary(sum);
  const ok = itemStatus(item);
  const tone = statusTone(ok, sum.total > 0);
  const title = item.name || item.id || "Untitled item";
  const subtitle = item.id && item.id !== item.name ? item.id : null;
  const note = item.note?.trim();
  const isManual = item.manual === true;
  const canDelete = allowDelete && Boolean(onDelete) && Boolean(item.manualKey);
  const hasIncomplete = ok !== true;
  const copyText = useMemo(() => buildItemCopyText(item, week), [item, week]);

  return (
    <div className={`item-card item-${tone}`}>
      <div className="item-header">
        <div className="item-heading">
          <div className="item-title-row">
            <div className="item-title">{title}</div>
            {isManual ? <span className="manual-pill">Manual</span> : null}
          </div>
          {subtitle ? <div className="item-meta">{subtitle}</div> : null}
        </div>
        <div className="item-actions">
          <StatusBadge ok={ok} total={sum.total} summary={summary} />
          {hasIncomplete ? (
            <CopyButton label="Copy incomplete details" text={copyText} disabled={!hasIncomplete} size="small" />
          ) : null}
          {canDelete ? (
            <button type="button" className="ghost-button compact" onClick={onDelete}>
              Remove
            </button>
          ) : null}
        </div>
      </div>

      {note ? <div className="item-note">{note}</div> : null}

      {sum.total > 0 ? (
        <ul className="subtask-list">
          {(item.checks ?? []).map((c, i) => {
            const key = c.id || c.name || c.type || `check-${i}`;
            return <CheckRow key={key} c={c} />;
          })}
        </ul>
      ) : (
        <div className="empty-subtasks">
          {isManual ? "No linked checks yet for this manual item." : "No sub tasks yet."}
        </div>
      )}
    </div>
  );
}

function ManualItemForm({
  disabled,
  onAdd,
}: {
  disabled: boolean;
  onAdd: (payload: { name: string; note?: string }) => void;
}) {
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedName = name.trim();
    const trimmedNote = note.trim();
    if (!trimmedName) {
      setError("Add a title before saving the manual item.");
      return;
    }
    onAdd({ name: trimmedName, note: trimmedNote || undefined });
    setName("");
    setNote("");
    setError(null);
  };

  return (
    <form className="manual-item-form" onSubmit={handleSubmit}>
      <label className="manual-label">
        Item title
        <input
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (error) setError(null);
          }}
          placeholder="Ship dashboard polish"
          disabled={disabled}
        />
      </label>
      <label className="manual-label">
        Notes <span className="manual-optional">(optional)</span>
        <textarea
          value={note}
          onChange={(e) => {
            setNote(e.target.value);
            if (error) setError(null);
          }}
          placeholder="Any extra context you want to track."
          disabled={disabled}
        />
      </label>
      {error ? <div className="manual-error">{error}</div> : null}
      <div className="manual-actions">
        <button type="submit" disabled={disabled || !name.trim()}>
          Add manual item
        </button>
      </div>
    </form>
  );
}

function WeekCard({
  week,
  manualReady,
  onAddManualItem,
  onDeleteItem,
  onResetManual,
}: {
  week: DecoratedWeek;
  manualReady: boolean;
  onAddManualItem: (weekKey: string, payload: { name: string; note?: string }) => void;
  onDeleteItem: (weekKey: string, item: DecoratedItem) => void;
  onResetManual: (weekKey: string) => void;
}) {
  const rollup = useMemo(() => {
    let total = 0,
      passed = 0,
      failed = 0,
      pending = 0;
    for (const it of week.items ?? []) {
      const s = summarizeChecks(it.checks);
      total += s.total;
      passed += s.passed;
      failed += s.failed;
      pending += s.pending;
    }
    return { total, passed, failed, pending };
  }, [week]);

  const summary = formatStatusSummary(rollup);
  const ok = weekStatus(week);
  const tone = statusTone(ok, rollup.total > 0);
  const title = week.title || week.id || "Untitled week";
  const subtitle = week.id && week.id !== week.title ? week.id : null;
  const items = week.items ?? [];
  const manualState = week.manualState ?? { added: [], removed: [] };
  const manualCounts = {
    added: manualState.added.length,
    removed: manualState.removed.length,
  };
  const manualSummaryParts: string[] = [];
  if (manualCounts.added > 0) manualSummaryParts.push(`${manualCounts.added} added`);
  if (manualCounts.removed > 0) manualSummaryParts.push(`${manualCounts.removed} hidden`);
  const manualSummary = manualSummaryParts.join(" · ");
  const showManualSummary = manualReady && manualSummaryParts.length > 0;

  return (
    <section className={`week-card week-${tone}`}>
      <div className="week-header">
        <div className="week-heading">
          <div className="week-title">{title}</div>
          {subtitle ? <div className="week-meta">{subtitle}</div> : null}
        </div>
        <StatusBadge ok={ok} total={rollup.total} summary={summary} />
      </div>

      {showManualSummary ? (
        <div className="manual-summary">
          <div className="manual-summary-text">{manualSummary}</div>
          <button type="button" className="ghost-button compact" onClick={() => onResetManual(week.manualKey)}>
            Reset week
          </button>
        </div>
      ) : null}

      {items.length > 0 ? (
        <div className="week-items">
          {items.map((it, i) => (
            <ItemCard
              key={`${it.manualKey ?? it.id ?? it.name ?? i}`}
              item={it}
              week={week}
              allowDelete={manualReady}
              onDelete={it.manualKey ? () => onDeleteItem(week.manualKey, it) : undefined}
            />
          ))}
        </div>
      ) : (
        <div className="empty-subtasks">No tasks tracked for this week yet.</div>
      )}

      <details className="manual-details">
        <summary>Add manual item</summary>
        <ManualItemForm disabled={!manualReady} onAdd={(payload) => onAddManualItem(week.manualKey, payload)} />
        {!manualReady ? <div className="manual-hint">Manual items are loading…</div> : null}
      </details>
    </section>
  );
}

function ProjectForm({
  onAdd,
  onSelect,
  className = "project-form",
  submitLabel = "Add project",
}: {
  onAdd: (repo: RepoRef) => RepoRef | null;
  onSelect?: (repo: RepoRef) => void;
  className?: string;
  submitLabel?: string;
}) {
  const [ownerInput, setOwnerInput] = useState("");
  const [repoInput, setRepoInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    let owner = ownerInput.trim();
    let repo = repoInput.trim();

    if (!repo && owner.includes("/")) {
      const [maybeOwner, maybeRepo] = owner.split("/");
      if (maybeOwner && maybeRepo) {
        owner = maybeOwner.trim();
        repo = maybeRepo.trim();
      }
    }

    if (!owner || !repo) {
      setError("Both owner and repo are required.");
      return;
    }

    const added = onAdd({ owner, repo });
    if (!added) {
      setError("Unable to add project. Check the owner and repo name.");
      return;
    }

    onSelect?.(added);
    setOwnerInput("");
    setRepoInput("");
    setError(null);
  };

  return (
    <form className={className} onSubmit={handleSubmit}>
      <div className="project-form-row">
        <div>
          <label>Owner or owner/repo</label>
          <input
            value={ownerInput}
            onChange={(e) => {
              setOwnerInput(e.target.value);
              if (error) setError(null);
            }}
            placeholder="acme-co"
            autoComplete="off"
          />
        </div>
        <div>
          <label>Repository</label>
          <input
            value={repoInput}
            onChange={(e) => {
              setRepoInput(e.target.value);
              if (error) setError(null);
            }}
            placeholder="dashboard"
            autoComplete="off"
          />
        </div>
      </div>
      {error ? <div className="project-error">{error}</div> : null}
      <button type="submit">{submitLabel}</button>
    </form>
  );
}

function ProjectSidebar({
  repos,
  activeKey,
  initializing,
  onSelect,
  onRemove,
  onAdd,
}: {
  repos: RepoRef[];
  activeKey: string | null;
  initializing: boolean;
  onSelect: (repo: RepoRef) => void;
  onRemove: (repo: RepoRef) => void;
  onAdd: (repo: RepoRef) => RepoRef | null;
}) {
  return (
    <aside className="project-panel">
      <div className="project-header">
        <h2>Projects</h2>
        <a className="project-wizard" href="/new">
          Open wizard ↗
        </a>
      </div>
      <div className="project-panel-body">
        {initializing ? <div className="project-hint">Loading saved projects…</div> : null}
        {repos.length === 0 ? (
          <div className="project-empty">
            No projects yet. Add one below or run the onboarding wizard to connect a repository.
          </div>
        ) : (
          <ul className="project-list">
            {repos.map((repo) => {
              const key = repoKey(repo.owner, repo.repo);
              const slug = `${repo.owner}/${repo.repo}`;
              const active = key === activeKey;
              return (
                <li key={key} className="project-item">
                  <button
                    type="button"
                    className={`project-button${active ? " active" : ""}`}
                    onClick={() => onSelect(repo)}
                  >
                    <span className="project-slug">{slug}</span>
                    {active ? <span className="project-active">Viewing</span> : null}
                  </button>
                  <button
                    type="button"
                    className="icon-button danger"
                    onClick={(event) => {
                      event.stopPropagation();
                      onRemove(repo);
                    }}
                    aria-label={`Remove ${slug}`}
                    title="Remove project"
                  >
                    ×
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <ProjectForm onAdd={onAdd} onSelect={onSelect} />
      </div>
    </aside>
  );
}

type AddProjectTabProps = {
  onAdd: (repo: RepoRef) => RepoRef | null;
  onSelect?: (repo: RepoRef) => void;
  wizardHref: string;
  hasProjects: boolean;
};

function GtmPlanTab({ repo }: GtmPlanTabProps) {
  const owner = repo?.owner ?? "";
  const repoName = repo?.repo ?? "";
  const [branchInput, setBranchInput] = useState("main");
  const [branch, setBranch] = useState("main");
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [planExists, setPlanExists] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const secrets = useLocalSecrets();
  const githubConfigured = Boolean(secrets.githubPat);

  useEffect(() => {
    if (!owner || !repoName) {
      setBranchInput("main");
      setBranch("main");
      setDraft("");
      setPlanExists(false);
      setSuccess(null);
      setError(null);
      setLoading(false);
      return;
    }
    setBranchInput("main");
    setBranch("main");
    setDraft("");
    setPlanExists(false);
    setSuccess(null);
    setError(null);
    setReloadKey((value) => value + 1);
  }, [owner, repoName]);

  useEffect(() => {
    if (!owner || !repoName) return;
    let cancelled = false;
    const query = branch ? `?branch=${encodeURIComponent(branch)}` : "";
    setLoading(true);
    setError(null);

    const requestInit: RequestInit = { cache: "no-store" };
    if (secrets.githubPat) {
      requestInit.headers = { "x-github-pat": secrets.githubPat };
    }

    fetch(`/api/gtm/${owner}/${repoName}${query}`, requestInit)
      .then(async (response) => {
        if (response.status === 404) {
          if (!cancelled) {
            setPlanExists(false);
            setDraft("");
          }
          return;
        }
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          const message =
            typeof (body as { error?: string })?.error === "string"
              ? (body as { error: string }).error
              : response.statusText || "Failed to load GTM plan";
          throw new Error(message);
        }
        const data = (await response.json()) as { content?: string };
        if (!cancelled) {
          setPlanExists(true);
          setDraft(typeof data?.content === "string" ? data.content : "");
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [owner, repoName, branch, reloadKey, secrets.githubPat]);

  const planUrl = planExists
    ? `https://github.com/${owner}/${repoName}/blob/${encodeURIComponent(branch)}/docs/gtm-plan.md`
    : null;
  const planPath = "docs/gtm-plan.md";

  const onBranchInputChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setBranchInput(event.currentTarget.value);
  }, []);

  const onDraftChange = useCallback((event: ChangeEvent<HTMLTextAreaElement>) => {
    setDraft(event.currentTarget.value);
  }, []);

  const onBranchSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!owner || !repoName) return;
      const next = branchInput.trim() || "main";
      setBranchInput(next);
      setSuccess(null);
      setError(null);
      if (next === branch) {
        setReloadKey((value) => value + 1);
      } else {
        setBranch(next);
      }
    },
    [branch, branchInput, owner, repoName],
  );

  const refreshPlan = useCallback(() => {
    if (!loading) {
      setSuccess(null);
      setError(null);
      setReloadKey((value) => value + 1);
    }
  }, [loading]);

  const createTemplate = useCallback(async () => {
    if (!owner || !repoName) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const headers: HeadersInit = { "Content-Type": "application/json" };
      if (secrets.githubPat) {
        headers["x-github-pat"] = secrets.githubPat;
      }
      const response = await fetch(`/api/gtm/${owner}/${repoName}`, {
        method: "POST",
        headers,
        body: JSON.stringify({ branch }),
      });
      const data = (await response.json().catch(() => ({}))) as CommitApiResponse;
      if (!response.ok || typeof data?.error === "string") {
        const message = typeof data?.error === "string" ? data.error : "Failed to scaffold GTM plan";
        throw new Error(message);
      }
      const content = typeof data?.content === "string" ? data.content : draft;
      setDraft(content);
      setPlanExists(true);
      const created = data?.created ?? true;
      setSuccess(created ? `Created ${planPath} on ${branch}` : `Updated ${planPath} on ${branch}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [branch, draft, owner, repoName, secrets.githubPat]);

  const onSave = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!owner || !repoName) return;
      if (!draft.trim()) {
        setError("Add details to the GTM plan before saving.");
        setSuccess(null);
        return;
      }
      setSaving(true);
      setError(null);
      setSuccess(null);
      try {
        const headers: HeadersInit = { "Content-Type": "application/json" };
        if (secrets.githubPat) {
          headers["x-github-pat"] = secrets.githubPat;
        }
        const response = await fetch(`/api/gtm/${owner}/${repoName}`, {
          method: "POST",
          headers,
          body: JSON.stringify({ branch, content: draft }),
        });
        const data = (await response.json().catch(() => ({}))) as CommitApiResponse;
        if (!response.ok || typeof data?.error === "string") {
          const message = typeof data?.error === "string" ? data.error : "Failed to save GTM plan";
          throw new Error(message);
        }
        const updated = typeof data?.content === "string" ? data.content : draft;
        setDraft(updated);
        setPlanExists(true);
        const created = data?.created ?? false;
        setSuccess(created ? `Created ${planPath} on ${branch}` : `Updated ${planPath} on ${branch}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setSaving(false);
      }
    },
    [branch, draft, owner, repoName, secrets.githubPat],
  );

  if (!owner || !repoName) {
    return (
      <section className="card gtm-plan-card">
        <div className="gtm-plan-header">
          <h2>GTM plan workspace</h2>
          <p className="hint">Select a project to review or scaffold its go-to-market plan.</p>
        </div>
        <div className="gtm-plan-empty">
          Add a repository from the sidebar and reopen this tab to capture launch strategy alongside your roadmap.
        </div>
      </section>
    );
  }

  return (
    <section className="card gtm-plan-card">
      <div className="gtm-plan-header">
        <h2>Go-to-market plan</h2>
        <p className="hint">Keep launch, pricing, and success metrics in lockstep with the engineering roadmap.</p>
        <p className="hint small">{githubConfigured ? "GitHub token ready" : "Add a GitHub PAT in Settings to save changes."}</p>
      </div>
      <div className="repo-line">
        <span className="repo-label">Repo:</span>
        <code>
          {owner}/{repoName}
        </code>
        {planUrl ? (
          <a href={planUrl} target="_blank" rel="noreferrer">
            View on GitHub ↗
          </a>
        ) : null}
      </div>
      <form className="gtm-plan-branch-form" onSubmit={onBranchSubmit}>
        <label htmlFor="gtm-plan-branch">Branch</label>
        <input
          id="gtm-plan-branch"
          name="branch"
          value={branchInput}
          onChange={onBranchInputChange}
          autoComplete="off"
          placeholder="main"
        />
        <div className="gtm-plan-branch-controls">
          <button type="submit" className="ghost-button compact" disabled={loading || saving}>
            Load branch
          </button>
          <button type="button" className="ghost-button compact" onClick={refreshPlan} disabled={loading}>
            Refresh
          </button>
        </div>
      </form>
      {error ? <div className="gtm-plan-error">{error}</div> : null}
      {success ? <div className="gtm-plan-success">{success}</div> : null}
      {loading ? <div className="hint">Loading GTM plan…</div> : null}
      {planExists ? (
        <form className="gtm-plan-editor" onSubmit={onSave}>
          <label htmlFor="gtm-plan-editor">{planPath}</label>
          <textarea
            id="gtm-plan-editor"
            value={draft}
            onChange={onDraftChange}
            disabled={saving}
          />
          <div className="gtm-plan-actions">
            <button type="submit" className="primary-button" disabled={saving}>
              Save GTM Plan
            </button>
            <span className="hint">Commits update <code>{planPath}</code> on {branch}.</span>
          </div>
        </form>
      ) : (
        <div className="gtm-plan-empty">
          <p>
            No GTM plan found on <code>{planPath}</code> in <code>{branch}</code>.
          </p>
          <div className="gtm-plan-actions">
            <button type="button" className="primary-button" onClick={createTemplate} disabled={saving || loading}>
              Create GTM Plan
            </button>
            <span className="hint">We will scaffold market, channel, pricing, and metrics sections automatically.</span>
          </div>
        </div>
      )}
    </section>
  );
}

function AddProjectTab(props: AddProjectTabProps) {
  const { onAdd, onSelect, wizardHref, hasProjects } = props;
  return (
    <section className="card add-project-card">
      <div className="add-project-header">
        <h2>Connect a new project</h2>
        <p>
          Add a repository to track its roadmap status here in the dashboard. Paste the owner and repository name, or launch the
          guided wizard to scaffold the required files automatically.
        </p>
      </div>
      <div className="add-project-actions">
        <a className="project-wizard" href={wizardHref} target="_blank" rel="noreferrer">
          Launch onboarding wizard ↗
        </a>
        <p className="hint">The wizard walks through secrets, workflows, and Supabase setup for a fresh project.</p>
      </div>
      <div className="add-project-wizard">
        <h3>Choose a guided workflow</h3>
        <p>
          Match the onboarding wizard to your current milestone. Jump into the playbook for an overview or launch the workspace tools
          directly when you are ready to build.
        </p>
        <div className="add-project-wizard-grid">
          {WIZARD_ENTRY_POINTS.map((entry) => (
            <WizardEntryCard key={entry.slug} entry={entry} />
          ))}
        </div>
      </div>
      <ProjectForm onAdd={onAdd} onSelect={onSelect} className="project-form" submitLabel="Save project" />
      <ul className="add-project-hints">
        <li>Use owner/repo to add quickly, e.g. <code>acme-co/roadmap</code>.</li>
        <li>Once saved, switch back to the Projects tab to monitor roadmap progress.</li>
        {hasProjects ? null : <li>Your first project will also appear in the sidebar for quick access.</li>}
      </ul>
    </section>
  );
}

function WizardEntryCard({ entry }: { entry: WizardEntryPoint }) {
  const router = useRouter();

  const handleNavigate = useCallback(() => {
    router.push(`/wizard/${entry.slug}`);
  }, [entry.slug, router]);

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        handleNavigate();
      }
    },
    [handleNavigate],
  );

  const stopPropagation = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    event.stopPropagation();
  }, []);

  return (
    <article
      role="button"
      tabIndex={0}
      className="add-project-wizard-card"
      onClick={handleNavigate}
      onKeyDown={handleKeyDown}
    >
      <div className="add-project-wizard-meta">
        <span className="add-project-wizard-label">{entry.label}</span>
        <span className="add-project-wizard-sub">Entry point</span>
      </div>
      <div className="add-project-wizard-copy">
        <h4>{entry.title}</h4>
        <p>{entry.description}</p>
      </div>
      <ul>
        {entry.bullets.map((bullet) => (
          <li key={bullet}>{bullet}</li>
        ))}
      </ul>
      <div className="add-project-wizard-actions">
        <Link
          href={`/wizard/${entry.slug}`}
          className="add-project-wizard-action add-project-wizard-action--primary"
          onClick={stopPropagation}
        >
          View playbook
        </Link>
        {entry.tools?.map((tool) => (
          <Link
            key={tool.href}
            href={tool.href}
            className="add-project-wizard-action"
            onClick={stopPropagation}
          >
            {tool.label}
          </Link>
        ))}
      </div>
      {entry.tools?.map((tool) =>
        tool.description ? (
          <p key={`${tool.href}-note`} className="add-project-wizard-note">
            {tool.description}
          </p>
        ) : null
      )}
    </article>
  );
}

function CopyButton({
  label,
  text,
  disabled,
  size = "default",
}: {
  label: string;
  text: string;
  disabled?: boolean;
  size?: "default" | "small";
}) {
  const [state, setState] = useState<CopyState>(CopyState.Idle);

  useEffect(() => {
    if (state === CopyState.Idle) return undefined;
    const timer = setTimeout(() => setState(CopyState.Idle), 1800);
    return () => clearTimeout(timer);
  }, [state]);

  const attemptCopy = useCallback(async () => {
    if (disabled) return;
    try {
      const success = await copyTextToClipboard(text);
      setState(success ? CopyState.Copied : CopyState.Error);
    } catch {
      setState(CopyState.Error);
    }
  }, [disabled, text]);

  const classNames = ["copy-button", `copy-${size}`];
  if (state === CopyState.Copied) classNames.push("copy-success");
  if (state === CopyState.Error) classNames.push("copy-error");

  const buttonLabel = state === CopyState.Copied ? "Copied!" : state === CopyState.Error ? "Copy failed" : label;

  return (
    <button
      type="button"
      className={classNames.join(" ")}
      onClick={attemptCopy}
      disabled={disabled}
      aria-live="polite"
    >
      <span className="copy-button-icon" aria-hidden="true">
        {state === CopyState.Copied ? "✅" : "📋"}
      </span>
      <span>{buttonLabel}</span>
    </button>
  );
}

function copyTextToClipboard(text: string) {
  if (typeof navigator === "undefined") return Promise.resolve(false);
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard
      .writeText(text)
      .then(() => true)
      .catch(() => false);
  }

  if (typeof document === "undefined") return Promise.resolve(false);

  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "absolute";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return Promise.resolve(ok);
  } catch {
    return Promise.resolve(false);
  }
}

function IncompleteSummary({ entries }: { entries: IncompleteEntry[] }) {
  const count = entries.length;
  const copyText = useMemo(() => buildOverallCopyText(entries), [entries]);

  return (
    <div className="incomplete-card">
      <div className="status-row">
        <div className="section-title">Incomplete tasks</div>
        <div className="incomplete-actions">
          <CopyButton label={`Copy all (${count})`} text={copyText} disabled={count === 0} />
        </div>
      </div>
      {count === 0 ? (
        <div className="empty-subtasks">All roadmap items are complete. 🎉</div>
      ) : (
        <ul className="incomplete-list">
          {entries.map((entry) => (
            <li key={entry.key} className="incomplete-item">
              <div className="incomplete-item-header">
                <div className="incomplete-item-title">{entry.itemLabel}</div>
                {entry.itemMeta ? <div className="incomplete-item-meta">{entry.itemMeta}</div> : null}
              </div>
              {entry.weekLabel ? <div className="incomplete-item-week">{entry.weekLabel}</div> : null}
              <div className="incomplete-item-status">Status: {entry.statusLabel}</div>
              <ul className="incomplete-blockers">
                {entry.blockers.map((blocker, idx) => (
                  <li key={`${entry.key}-blocker-${idx}`}>{blocker}</li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type ChecklistStatus = {
  ok: boolean | undefined;
  summary: string;
  hasCheck: boolean;
};

function summarizeChecklist(check: Check | undefined, fallback: string): ChecklistStatus {
  if (!check) {
    return { ok: undefined, summary: fallback, hasCheck: false };
  }
  return { ok: check.ok, summary: buildCheckSummary(check), hasCheck: true };
}

function OnboardingChecklist({
  status,
  projectSlug,
}: {
  status: StatusResponse | null;
  projectSlug?: string | null;
}) {
  const checks = useMemo(() => collectChecks(status), [status]);
  const hasStatusFeed = Boolean(status?.weeks && status.weeks.length > 0);

  const authStatus: ChecklistStatus = {
    ok: undefined,
    summary: "Provide GitHub App credentials",
    hasCheck: false,
  };

  const scriptCheck = useMemo(
    () =>
      checks.find(
        (chk) =>
          chk.type === "files_exist" &&
          (chk.globs ?? []).some((glob) => glob.includes("scripts/roadmap-check.mjs"))
      ),
    [checks]
  );

  const workflowCheck = useMemo(
    () =>
      checks.find(
        (chk) =>
          chk.type === "files_exist" &&
          (chk.globs ?? []).some((glob) => glob.includes(".github/workflows/roadmap.yml"))
      ),
    [checks]
  );

  const httpCheck = useMemo(() => checks.find((chk) => chk.type === "http_ok"), [checks]);
  const sqlCheck = useMemo(() => checks.find((chk) => chk.type === "sql_exists"), [checks]);

  const statusFeedStatus: ChecklistStatus = hasStatusFeed
    ? { ok: true, summary: "Status feed detected", hasCheck: false }
    : { ok: undefined, summary: "Waiting for first status run", hasCheck: false };

  const scriptStatus = summarizeChecklist(scriptCheck, "Add scripts/roadmap-check.mjs");
  const workflowStatus = summarizeChecklist(
    workflowCheck,
    "Add .github/workflows/roadmap.yml"
  );
  const httpStatus = summarizeChecklist(httpCheck, "Connect your read_only_checks endpoint");
  const sqlStatus = summarizeChecklist(sqlCheck, "Add at least one sql_exists check");

  const httpUrl = httpCheck?.url;
  const sqlQuery = sqlCheck?.query;

  return (
    <section className="card onboarding-card">
      <div className="onboarding-header">
        <h2>Project onboarding checklist</h2>
        <p className="onboarding-summary">
          {projectSlug
            ? `You're looking at ${projectSlug}. Use these steps to keep its status feed healthy.`
            : "Use this checklist to wire any repository into the roadmap dashboard."}
        </p>
      </div>

      <ol className="onboarding-list">
        <li className="onboarding-step">
          <div className="onboarding-step-header">
            <div>
              <div className="onboarding-step-title">1. Configure dashboard credentials</div>
              <p className="onboarding-step-description">
                Supply the GitHub App environment variables so the dashboard can fetch roadmap
                files from private repositories. Without them the server falls back to anonymous
                requests that cannot read <code>docs/roadmap.yml</code> or
                <code>docs/roadmap-status.json</code>.
              </p>
            </div>
            <StatusBadge ok={authStatus.ok} total={authStatus.hasCheck ? 1 : 0} summary={authStatus.summary} />
          </div>
          <details className="onboarding-details">
            <summary>Required GitHub App variables</summary>
            <div className="guide-actions">
              <CopyButton label="Copy env vars" text={GITHUB_APP_ENV_SNIPPET} />
            </div>
            <pre>
              <code>{GITHUB_APP_ENV_SNIPPET}</code>
            </pre>
          </details>
          <p className="onboarding-note">
            Long term, deploy with the GitHub App credentials. The setup flow will auto-detect the
            installation ID when <code>GH_APP_INSTALLATION_ID</code> is omitted, but you can provide
            it to pin a specific installation. For short tests you can temporarily make the
            repository public or commit a generated <code>docs/roadmap-status.json</code>, but those
            approaches leave the status API unable to reach private content.
          </p>
        </li>

        <li className="onboarding-step">
          <div className="onboarding-step-header">
            <div>
              <div className="onboarding-step-title">2. Bootstrap roadmap data</div>
              <p className="onboarding-step-description">
                Create <code>docs/roadmap.yml</code> so the checker knows which weeks and tasks to
                evaluate. Each workflow run will emit <code>docs/roadmap-status.json</code>, which the
                dashboard reads automatically.
              </p>
            </div>
            <StatusBadge
              ok={statusFeedStatus.ok}
              total={statusFeedStatus.hasCheck ? 1 : 0}
              summary={statusFeedStatus.summary}
            />
          </div>
          <details className="onboarding-details">
            <summary>Show sample docs/roadmap.yml</summary>
            <div className="guide-actions">
              <CopyButton label="Copy docs/roadmap.yml" text={ROADMAP_YAML_SNIPPET} />
            </div>
            <pre>
              <code>{ROADMAP_YAML_SNIPPET}</code>
            </pre>
          </details>
          <p className="onboarding-note">
            Commit <code>docs/roadmap.yml</code>. The generated <code>docs/roadmap-status.json</code>
            can be added to <code>.gitignore</code> if you prefer not to commit build artifacts.
          </p>
        </li>

        <li className="onboarding-step">
          <div className="onboarding-step-header">
            <div>
              <div className="onboarding-step-title">3. Add the checker script</div>
              <p className="onboarding-step-description">
                Drop <code>scripts/roadmap-check.mjs</code> into the repository and install the
                <code>js-yaml</code> dev dependency so the script can parse your roadmap definition.
              </p>
            </div>
            <StatusBadge
              ok={scriptStatus.ok}
              total={scriptStatus.hasCheck ? 1 : 0}
              summary={scriptStatus.summary}
            />
          </div>
          <details className="onboarding-details">
            <summary>Show scripts/roadmap-check.mjs</summary>
            <div className="guide-actions">
              <CopyButton label="Copy script" text={ROADMAP_CHECKER_SNIPPET} />
            </div>
            <pre>
              <code>{ROADMAP_CHECKER_SNIPPET}</code>
            </pre>
          </details>
          <details className="onboarding-details">
            <summary>Install dependencies &amp; package script</summary>
            <div className="guide-actions">
              <CopyButton label="Copy npm install" text={NPM_INSTALL_SNIPPET} />
              <CopyButton label="Copy package.json snippet" text={PACKAGE_JSON_SNIPPET} />
            </div>
            <pre>
              <code>{NPM_INSTALL_SNIPPET}</code>
            </pre>
            <pre>
              <code>{PACKAGE_JSON_SNIPPET}</code>
            </pre>
          </details>
          <p className="onboarding-note">
            When the workflow runs it will execute <code>npm install</code> automatically, so keep the
            script in source control to avoid missing-file failures.
          </p>
        </li>

        <li className="onboarding-step">
          <div className="onboarding-step-header">
            <div>
              <div className="onboarding-step-title">4. Wire GitHub Actions</div>
              <p className="onboarding-step-description">
                Update <code>.github/workflows/roadmap.yml</code> to call the checker. The example step
                below assumes the workflow already checks out your repo and installs dependencies.
              </p>
            </div>
            <StatusBadge
              ok={workflowStatus.ok}
              total={workflowStatus.hasCheck ? 1 : 0}
              summary={workflowStatus.summary}
            />
          </div>
          <details className="onboarding-details">
            <summary>Show workflow step</summary>
            <div className="guide-actions">
              <CopyButton label="Copy workflow step" text={WORKFLOW_STEP_SNIPPET} />
            </div>
            <pre>
              <code>{WORKFLOW_STEP_SNIPPET}</code>
            </pre>
          </details>
          <p className="onboarding-note">
            Keep the workflow on the default branch so status updates land in the dashboard without
            manual intervention.
          </p>
        </li>

        <li className="onboarding-step">
          <div className="onboarding-step-header">
            <div>
              <div className="onboarding-step-title">5. Expose a read-only database checker</div>
              <p className="onboarding-step-description">
                Deploy the <code>read_only_checks</code> Supabase Edge Function (or an equivalent API)
                using the drop-in source from <code>docs/supabase-read-only-checks.md</code>. That
                version accepts every payload shape the dashboard sends, preventing
                <code>invalid symbol</code> probe failures. Store the function URL in the
                <code>READ_ONLY_CHECKS_URL</code> repository secret so roadmap checks can validate
                database state without full credentials.
              </p>
            </div>
            <StatusBadge
              ok={httpStatus.ok}
              total={httpStatus.hasCheck ? 1 : 0}
              summary={httpStatus.summary}
            />
          </div>
          <details className="onboarding-details">
            <summary>Show secret value format</summary>
            <div className="guide-actions">
              <CopyButton label="Copy secret format" text={SECRET_SNIPPET} />
            </div>
            <pre>
              <code>{SECRET_SNIPPET}</code>
            </pre>
          </details>
          <p className="onboarding-note">
            {httpUrl
              ? `Latest run checked ${httpUrl}. Verify that the GitHub secret still points to this URL.`
              : "Add the secret under Settings → Secrets and variables → Actions → New repository secret."}
            {" "}Use the guide below whenever the Supabase function changes—the onboarding panel always
            mirrors the latest snippet.
          </p>
        </li>

        <li className="onboarding-step">
          <div className="onboarding-step-header">
            <div>
              <div className="onboarding-step-title">6. Confirm database coverage</div>
              <p className="onboarding-step-description">
                Add at least one <code>sql_exists</code> check so the dashboard verifies your critical
                database extensions, tables, or policies each run.
              </p>
            </div>
            <StatusBadge
              ok={sqlStatus.ok}
              total={sqlStatus.hasCheck ? 1 : 0}
              summary={sqlStatus.summary}
            />
          </div>
          <p className="onboarding-note">
            {sqlQuery
              ? `Your roadmap currently checks: ${sqlQuery}. Add more symbols (ext:, table:, rls:, policy:) as needed.`
              : "Use ext:, table:, rls:, or policy: symbols to describe the invariants your team cares about."}
          </p>
        </li>
      </ol>
    </section>
  );
}

function CreateEdgeFunctionGuide() {
  return (
    <section className="card guide-card">
      <div>
        <h2>Create Edge Function</h2>
        <p className="guide-summary">
          <strong>Where to obtain it (Supabase example).</strong> The template assumes you deploy a Supabase Edge Function named{" "}
          <code>read_only_checks</code>. Once the function is live, its public URL is{" "}
          <code>https://{"<project-ref>"}.functions.supabase.co/read_only_checks</code>{" "}
          where <code>{"<project-ref>"}</code> is the identifier shown in the Supabase dashboard under
          <strong> Settings → API</strong>. Add that URL to <code>.env.local</code> or <code>.roadmaprc.json</code> to wire the
          dashboard up.
        </p>
      </div>

      <ol className="guide-steps">
        <li>
          <strong>Collect your Supabase identifiers.</strong>
          <ul className="guide-list">
            <li>
              In the Supabase dashboard, open <strong>Settings → API</strong> to copy the <em>Project reference</em>,
              <em>Project URL</em>, <em>anon</em>, and <em>service_role</em> keys. The project reference is the value used in the
              function URL above.
            </li>
            <li>
              Under <strong>Settings → Database</strong>, grab the <em>Connection string (URI)</em>. If you have not generated a
              password yet, click <em>Reset database password</em>; the resulting password is the <code>{"<db-password>"}</code>
              placeholder in the commands below.
            </li>
            <li>Store the service role key securely—it grants full database access and should never ship to clients.</li>
          </ul>
        </li>
        <li>
          <strong>Supabase CLI workflow.</strong>
          <p className="guide-inline">
            Install the <code>supabase</code> CLI (<code>npm install -g supabase</code>) and run these commands from the
            repository root. Replace <code>{"<project-ref>"}</code> and <code>{"<db-password>"}</code> with the values gathered
            above.
          </p>
          <div className="guide-actions">
            <CopyButton label="Copy CLI commands" text={EDGE_FUNCTION_COMMANDS} />
          </div>
          <pre>
            <code>{EDGE_FUNCTION_COMMANDS}</code>
          </pre>
          <p className="guide-inline">
            Create a <code>supabase/.env</code> file with <code>SB_DB_URL=postgresql://postgres:{"<db-password>"}@db.
            {"<project-ref>"}.supabase.co:5432/postgres</code> (and optionally mirror it to
            <code>SUPABASE_DB_URL</code>) before running <code>supabase functions serve</code> locally.
          </p>
        </li>
        <li>
          <strong>Paste the edge function source.</strong>
          <p className="guide-inline">
            The CLI scaffolds <code>supabase/functions/read_only_checks/index.ts</code>. Replace its contents with the snippet
            below (also stored in <code>docs/supabase-read-only-checks.md</code>) so the function matches the dashboard’s
            payload parsing and only allows safe symbol checks.
          </p>
          <div className="guide-actions">
            <CopyButton label="Copy edge function" text={EDGE_FUNCTION_SNIPPET} />
          </div>
          <pre>
            <code>{EDGE_FUNCTION_SNIPPET}</code>
          </pre>
        </li>
        <li>
          <strong>Verify the deployed endpoint.</strong>
          <p className="guide-inline">After deploying, smoke-test the function directly:</p>
          <div className="guide-actions">
            <CopyButton label="Copy curl example" text={EDGE_FUNCTION_CURL} />
          </div>
          <pre>
            <code>{EDGE_FUNCTION_CURL}</code>
          </pre>
          <p className="guide-inline">
            A response of <code>{'{"ok":true}'}</code> confirms the check passed. Adjust the payload for the tables, RLS
            policies, or extensions you need to audit.
          </p>
        </li>
        <li>
          <strong>Connect the dashboard.</strong>
          <p className="guide-inline">Update your environment so the app knows where to call:</p>
          <pre>
            <code>READ_ONLY_CHECKS_URL=https://{"<project-ref>"}.functions.supabase.co/read_only_checks</code>
          </pre>
          <p className="guide-inline">
            Add the same value to <code>.roadmaprc.json</code> (<code>envs.dev.READ_ONLY_CHECKS_URL</code> and
            <code>envs.prod</code> if applicable) so the onboarding wizard and API stay in sync.
          </p>
        </li>
      </ol>
    </section>
  );
}

function DashboardPage() {
  const sp = useSearchParams();
  const searchString = sp.toString();
  const searchOwner = sp.get("owner");
  const searchRepo = sp.get("repo");
  const searchTab = sp.get("tab");
  const searchKey = searchOwner && searchRepo ? repoKey(searchOwner, searchRepo) : null;

  const router = useRouter();
  const pathname = usePathname();

  const { repos, initialized, addRepo, removeRepo } = useStoredRepos();
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const initialTab: TabKey = normalizeTab(searchTab);
  const [activeTab, setActiveTab] = useState<TabKey>(initialTab);
  const lastSearchKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const normalized = normalizeTab(searchTab);
    setActiveTab((prev) => (prev === normalized ? prev : normalized));
  }, [searchTab]);

  useEffect(() => {
    if (!initialized) return;

    if (!searchKey || !searchOwner || !searchRepo) {
      lastSearchKeyRef.current = null;
      setActiveKey((prev) => {
        if (prev && repos.some((repo) => repoKey(repo.owner, repo.repo) === prev)) {
          return prev;
        }
        return repos.length > 0 ? repoKey(repos[0].owner, repos[0].repo) : null;
      });
      return;
    }

    if (lastSearchKeyRef.current === searchKey) {
      return;
    }

    lastSearchKeyRef.current = searchKey;

    const exists = repos.some((repo) => repoKey(repo.owner, repo.repo) === searchKey);
    if (!exists) {
      const added = addRepo({ owner: searchOwner, repo: searchRepo });
      if (added) {
        setActiveKey(repoKey(added.owner, added.repo));
        return;
      }
    }

    setActiveKey(searchKey);
  }, [initialized, searchKey, repos, addRepo, searchOwner, searchRepo]);

  useEffect(() => {
    if (!initialized) return;

    setActiveKey((prev) => {
      if (prev && repos.some((repo) => repoKey(repo.owner, repo.repo) === prev)) {
        return prev;
      }
      return repos.length > 0 ? repoKey(repos[0].owner, repos[0].repo) : null;
    });
  }, [initialized, repos]);

  const handleTabChange = useCallback(
    (tab: TabKey) => {
      setActiveTab(tab);
      const params = new URLSearchParams(searchString);
      if (tab === "projects") {
        params.delete("tab");
      } else {
        params.set("tab", tab);
      }
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [pathname, router, searchString]
  );

  const activeRepo = useMemo(() => {
    if (!activeKey) return null;
    return repos.find((repo) => repoKey(repo.owner, repo.repo) === activeKey) ?? null;
  }, [repos, activeKey]);
  const wizardHref = useMemo(() => {
    if (!activeRepo) return "/new";
    const params = new URLSearchParams();
    params.set("owner", activeRepo.owner);
    params.set("repo", activeRepo.repo);
    return `/new?${params.toString()}`;
  }, [activeRepo]);

  useEffect(() => {
    if (!initialized) return;
    if (!activeRepo) return;
    if (
      searchOwner &&
      searchRepo &&
      searchOwner.toLowerCase() === activeRepo.owner.toLowerCase() &&
      searchRepo.toLowerCase() === activeRepo.repo.toLowerCase()
    ) {
      return;
    }
    const params = new URLSearchParams(searchString);
    params.set("owner", activeRepo.owner);
    params.set("repo", activeRepo.repo);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }, [activeRepo, initialized, pathname, router, searchOwner, searchRepo, searchString]);

  const { data, err, loading } = useStatus(activeRepo?.owner ?? "", activeRepo?.repo ?? "");
  const {
    state: manualState,
    ready: manualReady,
    addManualItem,
    removeManualItem,
    hideExistingItem,
    resetWeek,
    resetAll,
  } = useManualRoadmap(activeRepo?.owner, activeRepo?.repo);

  const decoratedWeeks: DecoratedWeek[] = useMemo(() => {
    if (!data) return [];
    return (data.weeks ?? []).map((week, weekIndex) => {
      const manualKey = getWeekKey(week, weekIndex);
      const manualWeek = manualState[manualKey] ?? { added: [], removed: [] };
      const baseItems: DecoratedItem[] = (week.items ?? []).map((item, itemIndex) => ({
        ...item,
        manual: false,
        manualKey: getItemKey(item, itemIndex),
      }));
      const filteredBase = baseItems.filter((item) => !manualWeek.removed.includes(item.manualKey ?? ""));
      const manualItems: DecoratedItem[] = manualWeek.added.map((manualItem) => ({
        id: manualItem.key,
        name: manualItem.name,
        note: manualItem.note,
        done: manualItem.done,
        checks: [],
        manual: true,
        manualKey: manualItem.key,
      }));
      return {
        ...week,
        manualKey,
        manualState: manualWeek,
        items: [...filteredBase, ...manualItems],
      };
    });
  }, [data, manualState]);

  const manualTotals = useMemo(() => {
    let added = 0;
    let removed = 0;
    for (const week of Object.values(manualState)) {
      added += week.added.length;
      removed += week.removed.length;
    }
    return { added, removed };
  }, [manualState]);

  const incompleteEntries = useMemo(() => collectIncompleteEntries(decoratedWeeks), [decoratedWeeks]);

  const hasManualChanges = manualReady && (manualTotals.added > 0 || manualTotals.removed > 0);

  const handleSelectRepo = useCallback(
    (repo: RepoRef) => {
      setActiveKey(repoKey(repo.owner, repo.repo));
      handleTabChange("projects");
    },
    [handleTabChange]
  );

  const handleAddRepo = useCallback(
    (repo: RepoRef) => {
      const added = addRepo(repo);
      if (added) {
        setActiveKey(repoKey(added.owner, added.repo));
        handleTabChange("projects");
      }
      return added;
    },
    [addRepo, handleTabChange]
  );

  const handleRemoveRepo = useCallback(
    (repo: RepoRef) => {
      removeRepo(repo);
    },
    [removeRepo]
  );

  const handleAddManualItem = useCallback(
    (weekKey: string, payload: { name: string; note?: string }) => {
      addManualItem(weekKey, payload);
    },
    [addManualItem]
  );

  const handleDeleteItem = useCallback(
    (weekKey: string, item: DecoratedItem) => {
      if (!item.manualKey) return;
      if (item.manual) {
        removeManualItem(weekKey, item.manualKey);
      } else {
        hideExistingItem(weekKey, item.manualKey);
      }
    },
    [hideExistingItem, removeManualItem]
  );

  return (
    <main className="dashboard-shell">
      <ProjectSidebar
        repos={repos}
        activeKey={activeKey}
        initializing={!initialized}
        onSelect={handleSelectRepo}
        onRemove={handleRemoveRepo}
        onAdd={handleAddRepo}
      />
      <section className="dashboard">
        <div className="tab-bar" role="tablist" aria-label="Dashboard sections">
          {TAB_KEYS.map((key) => {
            const label = TAB_LABELS[key];
            const selected = activeTab === key;
            return (
              <button
                key={key}
                id={`tab-${key}`}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls={`panel-${key}`}
                className={`tab-button${selected ? " active" : ""}`}
                onClick={() => {
                  if (!selected) handleTabChange(key);
                }}
              >
                {label}
              </button>
            );
          })}
        </div>

        {activeTab === "projects" ? (
          <div id="panel-projects" role="tabpanel" aria-labelledby="tab-projects" className="tab-panel">
            {activeRepo ? (
              <>
                <div className="repo-line">
                  <span className="repo-label">Repo:</span>
                  <code>
                    {activeRepo.owner}/{activeRepo.repo}
                  </code>
                  <a className="project-wizard" href={wizardHref} target="_blank" rel="noreferrer">
                    Create setup PR ↗
                  </a>
                  <a href={`/api/status/${activeRepo.owner}/${activeRepo.repo}`} target="_blank" rel="noreferrer">
                    View status JSON ↗
                  </a>
                </div>

                {hasManualChanges ? (
                  <div className="card manual-project-banner">
                    <div>
                      <div className="banner-title">Manual adjustments in this project</div>
                      <div className="banner-subtitle">
                        {manualTotals.added} added · {manualTotals.removed} hidden
                      </div>
                    </div>
                    <button type="button" className="ghost-button danger" onClick={resetAll} disabled={!manualReady}>
                      Reset all manual items
                    </button>
                  </div>
                ) : null}

                {loading ? <div className="card muted">Loading status…</div> : null}

                {err && !loading ? (
                  <div className="card error">
                    <div className="card-title">Failed to load status</div>
                    <div className="card-subtitle">{err}</div>
                    <div className="card-subtitle">
                      Try running the onboarding wizard at <code>/new</code>.
                    </div>
                  </div>
                ) : null}

                {decoratedWeeks.length > 0 ? <WeekProgress weeks={decoratedWeeks} /> : null}

                {decoratedWeeks.length > 0 ? <IncompleteSummary entries={incompleteEntries} /> : null}

                {data && decoratedWeeks.length > 0 ? (
                  <div className="week-grid">
                    {decoratedWeeks.map((week, i) => (
                      <WeekCard
                        key={`${week.manualKey ?? week.id ?? i}`}
                        week={week}
                        manualReady={manualReady}
                        onAddManualItem={handleAddManualItem}
                        onDeleteItem={handleDeleteItem}
                        onResetManual={resetWeek}
                      />
                    ))}
                  </div>
                ) : null}
                {data ? (
                  <div className="timestamp">
                    Generated at: {data.generated_at ?? "unknown"} · env: {data.env ?? "unknown"}
                  </div>
                ) : null}
                {!loading && !err && (!data || decoratedWeeks.length === 0) ? (
                  <div className="card muted">
                    No weeks found. Make sure your <code>.roadmaprc.json</code> or status API is populated.
                  </div>
                ) : null}
              </>
            ) : (
              <div className="card muted">
                Add a project from the sidebar to load its roadmap and weekly progress.
              </div>
            )}
          </div>
        ) : null}

        {activeTab === "gtm" ? (
          <div id="panel-gtm" role="tabpanel" aria-labelledby="tab-gtm" className="tab-panel">
            <GtmPlanTab repo={activeRepo} />
          </div>
        ) : null}

        {activeTab === "onboarding" ? (
          <div id="panel-onboarding" role="tabpanel" aria-labelledby="tab-onboarding" className="tab-panel">
            <OnboardingChecklist
              status={activeRepo ? data ?? null : null}
              projectSlug={activeRepo ? `${activeRepo.owner}/${activeRepo.repo}` : null}
            />
            <CreateEdgeFunctionGuide />
          </div>
        ) : null}

        {activeTab === "add" ? (
          <div id="panel-add" role="tabpanel" aria-labelledby="tab-add" className="tab-panel">
            <AddProjectTab
              onAdd={handleAddRepo}
              wizardHref={wizardHref}
              hasProjects={repos.length > 0}
            />
          </div>
        ) : null}
      </section>
    </main>
  );
}

function PageFallback() {
  return (
    <main className="dashboard-shell">
      <aside className="project-panel">
        <div className="project-header">
          <h2>Projects</h2>
        </div>
        <div className="project-panel-body">
          <div className="project-hint">Loading saved projects…</div>
        </div>
      </aside>
      <section className="dashboard">
        <div className="card muted">Loading dashboard…</div>
      </section>
    </main>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<PageFallback />}>
      <DashboardPage />
    </Suspense>
  );
}
