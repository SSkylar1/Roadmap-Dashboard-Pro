# Roadmap Dashboard Pro

[![Roadmap Checks](https://img.shields.io/github/actions/workflow/status/{{ORG}}/Roadmap-Kit-Starter/roadmap.yml?branch=main&label=roadmap)](https://github.com/{{ORG}}/Roadmap-Kit-Starter/actions/workflows/roadmap.yml)

> Replace `{{ORG}}` with your GitHub organization (and the repo name if you renamed
> the template) so the badge reflects your project’s live workflow status.

Next.js dashboard for roadmap-kit projects with **GitHub App auth** (PAT fallback), a **Settings** page to edit `.roadmaprc.json` via PR, and basic **webhook** support.

## Quickstart (local)

```bash
npm install
cp .env.example .env.local
# Fill ONE of the auth paths:
# - GitHub App: GH_APP_ID, GH_APP_PRIVATE_KEY, (optional) GH_APP_INSTALLATION_ID
# - OR PAT: GITHUB_TOKEN with repo scope
npm run dev
```

- `/new` — onboarding wizard (opens a setup PR)
- `/owner/repo` — status grid (reads `docs/roadmap-status.json`)
- `/owner/repo/settings` — edit `.roadmaprc.json` → PR
- `POST /api/verify` — proxy to your READ_ONLY_CHECKS_URL
- `POST /api/webhook` — optional GitHub webhook endpoint

## Deploy (Vercel)

Add env vars (Production + Preview):
- **GitHub App**: `GH_APP_ID`, `GH_APP_PRIVATE_KEY`, `GH_APP_INSTALLATION_ID` (optional)
- or **PAT**: `GITHUB_TOKEN`
- `READ_ONLY_CHECKS_URL` for the verify API
- (optional) `GITHUB_WEBHOOK_SECRET` if you add a webhook
