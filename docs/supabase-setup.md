# Supabase setup for Roadmap Dashboard Pro secrets

The dashboard now stores GitHub/OpenAI/Supabase tokens server-side in Supabase so they never persist in the browser. Follow the steps below to provision Supabase and migrate any existing local secrets.

## 1. Decide whether to reuse or create a Supabase project

You **do not need** a dedicated Supabase project if you already have one for your roadmap data or read-only checks. Adding the `dashboard_secrets` table is isolated to the `public` schema and won\'t interfere with other tables.

Create a new Supabase project only when:

- You want secrets storage completely separate from other data; or
- Your existing project belongs to a different organization/account.

Whichever project you use must allow server-side access with the service-role key.

## 2. Obtain the project URL and service-role key

1. Open the Supabase dashboard → your project → **Project Settings → API**.
2. Copy the **Project URL** (`https://...supabase.co`).
3. Copy the **service_role** key (this is sensitive—store it securely and never expose it to the client).

## 3. Configure environment variables

Add the following to `.env.local` for local development and to your deployment platform (e.g., Vercel → Settings → Environment Variables):

```bash
SB_URL="https://<your-project-ref>.supabase.co"
SB_SERVICE_ROLE_KEY="<service-role-key>"
```

> These values are required wherever the Next.js server runs. The browser never sees the service-role key because only the API routes reference it.
>
> **Migrating from older env vars?** The code still recognizes `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` (and their `NEXT_PUBLIC_` counterparts) as a fallback, but prefer the new `SB_` names so runtime errors point at a single source of truth.

## 4. Provision the `dashboard_secrets` table

Run the SQL in [`docs/supabase-dashboard-secrets.sql`](./supabase-dashboard-secrets.sql) against the project\'s `public` schema. You can do this via the Supabase dashboard **SQL Editor** or with the `supabase` CLI:

```bash
supabase db remote commit --file docs/supabase-dashboard-secrets.sql
```

The script will:

- Create the `dashboard_secrets` table and unique index for repo/project scopes.
- Enable Row Level Security (RLS).
- Add a policy that grants read/write access exclusively to the service role.

No other roles (e.g., `anon`, `authenticated`) will be able to read secrets, so they remain server-only.

> **Troubleshooting:** until this migration runs, any dashboard API call will fail with messages such as `Could not find the table 'public.dashboard_secrets' in the schema cache`. That's Supabase reporting that the table is missing—run the SQL above and redeploy to resolve it.

## 5. Deploy with the new env vars

Redeploy your Next.js app (e.g., `npm run build` locally, or trigger a Vercel redeploy). During boot, the API routes will read `SB_URL` + `SB_SERVICE_ROLE_KEY` and start persisting secrets to the database.

## 6. Migrate existing secrets from local storage (if any)

The previous versions of the dashboard cached secrets in `localStorage`. To move them into Supabase:

1. Open the dashboard in a browser that still has the old local cache.
2. Visit **Settings** for each repo/project. The form will prefill from the cache.
3. Click **Save settings**. The app now calls `/api/settings/save`, which normalizes and encrypts the payload before storing it in Supabase.
4. Reload the page (or open it in a fresh browser). The settings page will fetch from `/api/settings`, decrypt on the server, and hydrate the UI without leaving secrets in the client.

> After the save succeeds, the client clears its in-memory cache at navigation time, and secrets no longer persist in `localStorage`.

If you no longer have a browser with the legacy data, re-enter the keys manually on the settings page—the save flow will add them to Supabase.

## 7. Verify storage (optional)

Run the dashboard locally with `npm run dev` and watch the terminal; successful saves log the Supabase upsert. You can also query the table from the Supabase SQL Editor to confirm encrypted rows appear.

Remember that the payloads are encrypted using AES-GCM with a key derived from the service-role key, so the stored text is unintelligible without server access.

---

Once these steps are complete, the dashboard fully relies on Supabase for secrets persistence, eliminating the need for local browser storage.
