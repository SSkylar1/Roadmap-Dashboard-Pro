# Dashboard Playbook Inventory

This summary captures what the Roadmap Dashboard playbooks produced in this repository as of the latest verification run (`npm run roadmap:check`). It double-checks the concerns that the earlier audit raised so you can see which follow-ups are still outstanding (spoiler: there are none).

## Baseline scaffolding (Weeks 1–2)
- ✅ `.roadmaprc.json` points to `docs/roadmap.yml` and seeds verify targets for Supabase read-only checks.
- ✅ `docs/roadmap.yml` follows the generated template structure with `weeks` and `items`, so the checker can evaluate each deliverable.
- ✅ `.github/workflows/roadmap.yml` exists and runs the roadmap sync workflow.
- ✅ `scripts/roadmap-check.mjs` is present and successfully wrote `docs/roadmap-status.json` during the last run.

## Dashboard surfaces & API endpoints (Weeks 3–4)
- ✅ `app/api/status/[owner]/[repo]/route.ts`, `app/api/verify/route.ts`, and `app/api/webhook/route.ts` were all generated.
- ✅ The dashboard UI is committed (`app/page.tsx` + `app/HomeClient.tsx`).

## Documentation & follow-through (Weeks 9–10, 23–24)
- ✅ `README.md` includes the Roadmap Checks badge placeholder and deployment guidance.
- ✅ Late-stage docs—`docs/template-usage.md` and `docs/one-pager.md`—are present.

## Environment templates & helper scripts
- ✅ `.env.example` enumerates the GitHub App, PAT fallback, Supabase, webhook, and read-only variables expected by the dashboard.
- ✅ Utility scripts (`scripts/check-env.mjs`, `scripts/gh-debug.mjs`, `scripts/write-files-via-api.mjs`) shipped with the repo.

## Verification output

```
$ npm run roadmap:check
# ...
# wrote docs/roadmap-status.json
```

The regenerated `docs/roadmap-status.json` shows every roadmap checklist item with `"done": true`, matching the file inventory above.

## Outstanding work

None — the dashboard template, API surface, documentation, and helper scripts that the playbooks are expected to deliver are all present in this repo. If you run into functional issues, troubleshoot them as product bugs rather than missing scaffolding (e.g., check environment variables, Supabase connectivity, or GitHub App credentials).
