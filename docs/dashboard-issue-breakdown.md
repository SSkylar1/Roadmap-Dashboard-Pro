# Dashboard Issue Breakdown

This document summarizes the key data flows and common failure points for the Roadmap Dashboard so that another Codex session attached to the deployment repository can diagnose missing state or integration regressions.

## 1. Secrets persistence
- **Required env vars:** `SB_URL` + `SB_SERVICE_ROLE_KEY` (or `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`). Absence causes Supabase helper hard-failures before any secrets are saved.
- **Save path:** `/api/settings/save` → `persistSecrets` encrypts per-scope payloads with AES-256-GCM derived from the Supabase service-role key and upserts into `dashboard_secrets`. Rows missing from the payload are deleted. Missing DB migrations surface as `dashboard_secrets` table errors.
- **Load path:** `/api/settings` reads from `dashboard_secrets`, decrypts, merges defaults → repo → project precedence via `resolveSecrets`, then broadcasts to clients. If the UI shows stale settings, confirm the GET route runs and Supabase returns rows.

## 2. Manual roadmap overrides
- Expected location: Supabase `roadmap_manual_state` table.
- Fallback when Supabase is unavailable: local JSON at `.roadmap-dashboard/manual-store.json` (overridable with `ROADMAP_DASHBOARD_MANUAL_STORE_PATH`).
- If overrides disappear, verify env vars/table existence or inspect the local file to confirm fallback usage.

## 3. Roadmap ingestion & status recompute
- **Upload:** `/api/roadmaps/ingest` normalizes YAML/JSON, computes duplicate/status counts, inserts into Supabase `roadmaps` table. With `STANDALONE_MODE=true`, inserts go to the local standalone store instead. Missing Supabase env vars produce `supabase_not_configured`.
- **Re-check:** `/api/roadmaps/[id]/checks` reloads normalized data, recomputes counts, and updates the same record (or standalone store in standalone mode).
- **Local persistence:** `.roadmap-dashboard/standalone-store.json` (override via `ROADMAP_DASHBOARD_STANDALONE_STORE_PATH`). Review README standalone notes for GitHub/Supabase limitations.

## 4. Context pack assembly
- Route: `/api/context/[owner]/[repo]`.
- Hosted mode: fetches roadmap/status/tech-stack files directly from GitHub via `getFileRaw`, optionally scoped to branch/project overlays.
- Standalone mode: synthesizes files from local standalone stores.
- Missing required files triggers `missing_required_files`; verify `docs/*` assets exist in target repo.
- Always attempts to merge manual overrides through `loadManualState`, so Supabase/local-store failures surface here.

## 5. GitHub write path
- `.roadmaprc.json` edits and onboarding PRs use GitHub helpers. `/api/settings` POST → `openEditRcPR` ensures branch, upserts via GitHub Contents API, opens/reuses PR.
- If repo never updates, confirm GitHub App credentials & PAT (`GITHUB_APP_ID`, `GITHUB_INSTALLATION_ID`, `GITHUB_PRIVATE_KEY`, `GITHUB_TOKEN`/`ROADMAP_PAT`). Inspect helper logs for branch/PR creation errors.

## 6. Hosted dashboard expectations
- Weekly progress only renders when `docs/roadmap-status.json` exists. `roadmap.yml` GitHub Action calls hosted dashboard on each push/PR to regenerate status.
- If UI shows `STATUS_NOT_FOUND`, check workflow execution (Actions tab) and ensure it completes successfully.

## 7. Repository assets & workflow secrets
- Required files: `.github/workflows/roadmap.yml`, `docs/roadmap.yml`, `docs/roadmap-status.json`. Compare with Roadmap-Kit Starter if unsure.
- Required repo secrets: `DASHBOARD_URL` (hosted origin) and `READ_ONLY_CHECKS_URL` (Supabase edge probe). Re-run Roadmap Sync after configuring so artifacts refresh.

## 8. Deployment-side credentials
- Hosted deployment must expose GitHub App creds plus commit-capable token.
- After saving in Vercel/host, redeploy and inspect logs for auth errors.

## 9. Manual troubleshooting flow
1. POST to `${DASHBOARD_URL}/api/run` with owner, repo, branch, and `READ_ONLY_CHECKS_URL` to mimic GitHub Action behavior.
2. Validate response JSON and confirm commits land updating roadmap artifacts.
3. If failures mirror hosted workflow, debug Supabase/GitHub credentials accordingly.

## 10. Reminder: onboarding checklist
- If dashboard still reports `STATUS_NOT_FOUND`, re-run onboarding wizard, verify repo files/secrets, then manually trigger Roadmap Sync. Mirrors official troubleshooting steps.

## Next steps for Codex debugging session
1. Verify env vars + Supabase tables/migrations (`dashboard_secrets`, `roadmap_manual_state`, `roadmaps`).
2. Inspect local fallback JSON stores when Supabase unavailable.
3. Exercise each API (`/api/settings`, `/api/settings/save`, `/api/roadmaps/ingest`, `/api/roadmaps/{id}/checks`, `/api/context/...`, `/api/run`) and note failures.
4. Confirm GitHub App + PAT credentials allow writes by inspecting branch/PR creation via `openEditRcPR`.
5. Ensure GitHub Action assets + secrets exist; re-run workflow and review logs.
