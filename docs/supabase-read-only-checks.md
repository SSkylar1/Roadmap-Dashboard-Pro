# Supabase `read_only_checks` Edge Function

The dashboard (and the generated `scripts/roadmap-check.mjs` helper) probe your
Supabase project by POSTing a single **symbol** that describes the database
invariant to check. To maximize compatibility, the probe will retry the same
symbol using several JSON shapes:

```
{"queries": ["ext:pgcrypto"]}
{"query": "ext:pgcrypto"}
{"symbols": ["ext:pgcrypto"]}
{"symbol": "ext:pgcrypto"}
{"symbols": "ext:pgcrypto"}
"ext:pgcrypto"
```

If your edge function only reads `body.query` it will reject the other payloads
with an `invalid symbol` error. Update the function so it can extract the symbol
from any of the shapes above (arrays, nested `results` objects, etc.).

Below is a drop-in `read_only_checks` function that mirrors the dashboard’s
parsing logic and passes CORS preflight requests. You can paste it into
`supabase/functions/read_only_checks/index.ts` after scaffolding the function via
`supabase functions new read_only_checks --no-verify-jwt`.

```ts
import { Pool, type PoolClient } from "https://deno.land/x/postgres@v0.17.0/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const connectionString = Deno.env.get("SUPABASE_DB_URL") ?? Deno.env.get("DATABASE_URL");

if (!connectionString) {
  throw new Error("Set the SUPABASE_DB_URL secret before deploying this function.");
}

const pool = new Pool(connectionString, 1, true);
const READ_ROLES = ["anon", "authenticated"];
const READ_ROLES_SQL = READ_ROLES.map((role) => "'" + role + "'").join(", ");
const allowed = /^(ext:[a-z0-9_]+|table:[a-z0-9_]+:[a-z0-9_]+|rls:[a-z0-9_]+:[a-z0-9_]+|policy:[a-z0-9_]+:[a-z0-9_]+:[a-z0-9_]+)$/;

function pickSymbol(payload: unknown): string | null {
  if (!payload) return null;
  if (typeof payload === "string") return payload;
  if (Array.isArray(payload)) {
    for (const entry of payload) {
      const candidate = pickSymbol(entry);
      if (candidate) return candidate;
    }
    return null;
  }
  if (typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    const direct = [record.query, record.symbol, record.q];
    for (const entry of direct) {
      if (typeof entry === "string") return entry;
    }
    const multi = [record.queries, record.symbols];
    for (const entry of multi) {
      if (!entry) continue;
      if (typeof entry === "string") return entry;
      if (Array.isArray(entry)) {
        for (const value of entry) {
          const candidate = pickSymbol(value);
          if (candidate) return candidate;
        }
        continue;
      }
      const candidate = pickSymbol(entry);
      if (candidate) return candidate;
    }
    const nestedKeys = ["result", "results", "data", "payload"];
    for (const key of nestedKeys) {
      const candidate = pickSymbol(record[key]);
      if (candidate) return candidate;
    }
  }
  return null;
}

async function withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

async function checkExtension(ext: string): Promise<boolean> {
  const result = await withClient((client) =>
    client.queryObject<{ exists: boolean }>(
      "select exists(select 1 from pg_extension where extname = $1) as exists",
      ext,
    )
  );
  return result.rows[0]?.exists ?? false;
}

async function checkTable(schema: string, table: string): Promise<boolean> {
  const sql =
    "select coalesce(bool_or(privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE')), false) as has_write " +
    "from information_schema.role_table_grants where table_schema = $1 and table_name = $2 and grantee in (" +
    READ_ROLES_SQL +
    ")";
  const result = await withClient((client) => client.queryObject<{ has_write: boolean }>(sql, schema, table));
  return !(result.rows[0]?.has_write ?? false);
}

async function checkRls(schema: string, table: string): Promise<boolean> {
  const identifier = schema + "." + table;
  const result = await withClient((client) =>
    client.queryObject<{ enabled: boolean }>(
      "select relrowsecurity as enabled from pg_class where oid = to_regclass($1)",
      identifier,
    )
  );
  return result.rows[0]?.enabled ?? false;
}

async function checkPolicy(schema: string, table: string, policy: string): Promise<boolean> {
  const result = await withClient((client) =>
    client.queryObject<{ count: number }>(
      "select count(*)::int as count from pg_policies where schemaname = $1 and tablename = $2 and policyname = $3 and command = 'SELECT'",
      schema,
      table,
      policy,
    )
  );
  return (result.rows[0]?.count ?? 0) > 0;
}

async function runCheck(symbol: string): Promise<boolean> {
  const parts = symbol.split(":");
  const kind = parts[0];
  if (kind === "ext" && parts.length === 2) return checkExtension(parts[1]);
  if (kind === "table" && parts.length === 3) return checkTable(parts[1], parts[2]);
  if (kind === "rls" && parts.length === 3) return checkRls(parts[1], parts[2]);
  if (kind === "policy" && parts.length === 4) return checkPolicy(parts[1], parts[2], parts[3]);
  return false;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, error: "invalid payload" }), {
      status: 400,
      headers: Object.assign({ "Content-Type": "application/json" }, corsHeaders),
    });
  }

  const symbol = pickSymbol(body);
  if (typeof symbol !== "string" || !allowed.test(symbol)) {
    return new Response(JSON.stringify({ ok: false, error: "invalid symbol" }), {
      status: 400,
      headers: Object.assign({ "Content-Type": "application/json" }, corsHeaders),
    });
  }

  try {
    const ok = await runCheck(symbol);
    return new Response(JSON.stringify({ ok }), {
      status: 200,
      headers: Object.assign({ "Content-Type": "application/json" }, corsHeaders),
    });
  } catch (error) {
    console.error(error);
    return new Response(JSON.stringify({ ok: false, error: "check failed" }), {
      status: 500,
      headers: Object.assign({ "Content-Type": "application/json" }, corsHeaders),
    });
  }
});
```

Once deployed, smoke-test the function directly:

```
curl -X POST https://<project-ref>.functions.supabase.co/read_only_checks \
  -H "Content-Type: application/json" \
  -d '{"queries":["ext:pgcrypto"]}'
```

A response of `{"ok":true}` confirms the check passed. If you require Supabase
service-role authentication, set the same headers under `READ_ONLY_CHECKS_HEADERS`
in `.env.local` and your deployment environment.
