# Roadmap Dashboard Pro

[![Roadmap Checks](https://img.shields.io/github/actions/workflow/status/{{ORG}}/Roadmap-Kit-Starter/roadmap.yml?branch=main&label=roadmap)](https://github.com/{{ORG}}/Roadmap-Kit-Starter/actions/workflows/roadmap.yml)

> Replace `{{ORG}}` with your GitHub organization (and the repo name if you renamed
> the template) so the badge reflects your project’s live workflow status.

Next.js dashboard for roadmap-kit projects with **GitHub App auth** (PAT fallback), a **Settings** page to edit `.roadmaprc.json` via PR, and basic **webhook** support.

## Smart editor & project management

- **Smart editor card** – On the main dashboard (`/`), open a project and use the **Smart editor** to load any file in the repo, apply GPT-powered wording tweaks, and save the result to the selected branch. Provide a short instruction and the tool sends the request to the OpenAI API configured in Settings (`OPENAI_API_KEY`). It respects project-aware paths so Roadmap Kit overlays remain intact.
- **Rewrite assistance** – When checks are almost passing, click **Ask GPT to rewrite** and the dashboard will suggest edits that keep structure intact while updating phrasing so verification jobs turn green. Review the diff before saving.
- **Repo/project removal** – Every wizard workspace (Brainstorm, Concept, Mid-project, and Roadmap) now includes removal controls. Use the kebab menu next to the repo/project selector to delete stale entries from encrypted storage without leaving the flow.

> The smart editor depends on the `/api/editor/*` routes. Confirm your deployment allows outbound requests to `api.openai.com` and store the OpenAI key via Settings → Secrets.

## Quickstart (local)

```bash
npm install
cp .env.example .env.local
# Optional: set STANDALONE_MODE=true to use in-memory workflows without Supabase/GitHub writes
# Fill ONE of the auth paths:
# - GitHub App: GH_APP_ID, GH_APP_PRIVATE_KEY (GH_APP_INSTALLATION_ID optional; the wizard auto-detects when omitted)
# - OR PAT: GITHUB_TOKEN with repo scope
npm run dev
```

- `/new` — onboarding wizard (opens a setup PR)
- `/owner/repo` — status grid (reads `docs/roadmap-status.json`)
- `/owner/repo/settings` — edit `.roadmaprc.json` → PR
- `POST /api/verify` — proxy to your READ_ONLY_CHECKS_URL
- `POST /api/webhook` — optional GitHub webhook endpoint

> **Secrets persistence**: Add `SB_URL` and `SB_SERVICE_ROLE_KEY` to `.env.local` (or your deployment
> environment) so settings saved in the dashboard are encrypted and stored in Supabase. Provision the
> `dashboard_secrets` table with `docs/supabase-dashboard-secrets.sql` before using the API routes. The
> [Supabase setup guide](docs/supabase-setup.md) walks through these steps and explains how to migrate any
> local secrets into the new storage. For backward compatibility the code still falls back to
> `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`, but migrate to the `SB_` names when you can to avoid
> confusion when reading runtime errors.

## Standalone mode

Standalone mode keeps roadmap ingestion and status runs entirely local so you can demo the dashboard without wiring it up to
Supabase or GitHub.

### Prerequisites

- Keep the Supabase migrations ready for when you reconnect to a persistent backend. Run
  [`docs/supabase-dashboard-secrets.sql`](docs/supabase-dashboard-secrets.sql) to create the encrypted secrets table and
  [`docs/supabase-roadmap-progress.sql`](docs/supabase-roadmap-progress.sql) to capture manual roadmap adjustments once you
  leave standalone mode.
- Copy `.env.example` to `.env.local` and toggle `STANDALONE_MODE=true` (see the Quickstart snippet above).

### Features and limitations

- The roadmap wizard (`/wizard/roadmap/workspace`) and status API (`/api/roadmaps/*`, `/api/status/*`) now persist their
  standalone stores to `.roadmap-dashboard/standalone-store.json` (relative to your project directory). Restarting the dev
  server keeps the latest roadmap and status snapshots. Set `ROADMAP_DASHBOARD_STANDALONE_STORE_PATH` to override the file
  location if you prefer a custom directory.
- GitHub branch operations, Supabase persistence, webhook verification, and PAT inputs are intentionally disabled. The UI will
  show a "Standalone Mode" notice wherever these controls normally appear.
- Brainstorm, concept, mid-project, and roadmap flows continue to accept uploads or pasted `.roadmap.yml` content so you can
  validate structure and rehearse workshops without committing anything to GitHub.

### Launching standalone workflows

1. Set `STANDALONE_MODE=true` in `.env.local` and restart `npm run dev`.
2. Open `http://localhost:3000/new` to create a workspace, then dive into the wizard cards (Brainstorm → Concept → Mid-project →
   Roadmap) to upload artifacts.
3. Review the generated status cards locally—the dashboard reads from the standalone stores until you remove the environment
   flag.

### Verify your GitHub App env vars

1. Run `npm run check-env` (or `node scripts/check-env.mjs`) locally. The script prints whether `GH_APP_ID` and the private-key
   variables are detected and previews the first/last characters so you can confirm the formatting.
2. If you are using a raw PEM private key, make sure the value in `.env.local` contains real newlines. When in doubt, base64 encode it
   with `openssl base64 -A -in your-key.pem` and paste the single-line output into `GH_APP_PRIVATE_KEY_B64` instead.
3. Commit **only** `.env.example`. Keep `.env.local` and the PEM file out of git (they are ignored by default) and mirror the same
   values inside your Vercel project under *Settings → Environment Variables*.

## Deploy (Vercel)

Add env vars (Production + Preview):
- **GitHub App**: `GH_APP_ID`, `GH_APP_PRIVATE_KEY` (`GH_APP_INSTALLATION_ID` optional; the setup wizard will look it up)
- or **PAT**: `GITHUB_TOKEN`
- `READ_ONLY_CHECKS_URL` for the verify API (see `docs/supabase-read-only-checks.md` for a compatible edge function)
- (optional) `READ_ONLY_CHECKS_HEADERS` when your Supabase function requires auth headers (JSON string or `Key: Value` pairs separated by semicolons/newlines)
- (optional) `GITHUB_WEBHOOK_SECRET` if you add a webhook
- `SB_URL` + `SB_SERVICE_ROLE_KEY` for encrypted settings storage (`docs/supabase-dashboard-secrets.sql` sets up the table & RLS policies)

> **Security tip:** Store these secrets in your deployment platform (e.g., Vercel env vars) or in a local `.env.local` file for development. Do **not** commit GitHub App credentials to your roadmap repo—no branch should contain the raw private key.
