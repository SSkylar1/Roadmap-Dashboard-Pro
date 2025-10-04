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
# - GitHub App: GH_APP_ID, GH_APP_PRIVATE_KEY (GH_APP_INSTALLATION_ID optional; the wizard auto-detects when omitted)
# - OR PAT: GITHUB_TOKEN with repo scope
npm run dev
```

- `/new` — onboarding wizard (opens a setup PR)
- `/owner/repo` — status grid (reads `docs/roadmap-status.json`)
- `/owner/repo/settings` — edit `.roadmaprc.json` → PR
- `POST /api/verify` — proxy to your READ_ONLY_CHECKS_URL
- `POST /api/webhook` — optional GitHub webhook endpoint

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
- `READ_ONLY_CHECKS_URL` for the verify API
- (optional) `READ_ONLY_CHECKS_HEADERS` when your Supabase function requires auth headers (JSON string or `Key: Value` pairs separated by semicolons/newlines)
- (optional) `GITHUB_WEBHOOK_SECRET` if you add a webhook

> **Security tip:** Store these secrets in your deployment platform (e.g., Vercel env vars) or in a local `.env.local` file for development. Do **not** commit GitHub App credentials to your roadmap repo—no branch should contain the raw private key.
