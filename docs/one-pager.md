# Roadmap Dashboard in 30 Minutes

**Goal:** equip a new initiative with the roadmap dashboard, automation, and docs in
under half an hour.

## Who this is for

- Engineering managers who need transparent roadmap execution.
- Program leads accountable for cross-team alignment.
- Developer advocates onboarding partners to roadmap-kit.

## Why it matters

- Centralizes roadmap progress, documentation, and automation in one repo.
- Reduces setup time from days to minutes by reusing the bootstrap template.
- Keeps delivery predictable through automated checklist enforcement.

## Step-by-step plan

1. **Create the repo** using the bootstrap template (`Use this template → Create`).
2. **Install dependencies** locally: `npm install` then copy `.env.example` to `.env.local`.
3. **Configure credentials** with either the GitHub App (preferred) or a short-lived PAT.
4. **Update `.roadmaprc.json`** with the correct `READ_ONLY_CHECKS_URL` for your Supabase Edge
   function (or equivalent read-only verifier).
5. **Edit `docs/roadmap.yml`** to reflect the actual initiatives and dependent files.
6. **Run `npm run roadmap:check`** to validate files exist before pushing your first branch.
7. **Open the dashboard** at `npm run dev` → http://localhost:3000/new to confirm onboarding works.

## Timeline & owners

| Minute | Owner             | Outcome                                           |
| ------ | ----------------- | -------------------------------------------------- |
| 0–5    | Program manager   | Repo created from template, checklist assigned.   |
| 5–15   | Tech lead         | Credentials configured, roadmap updated.          |
| 15–25  | Engineer          | Checks pass locally, CI workflow green on GitHub. |
| 25–30  | Entire group      | Dashboard demoed and adoption next steps logged.  |

## Success metrics

- Roadmap Sync workflow passes on the initial PR.
- Dashboard shows zero failing checklist items.
- Teams can self-serve updates using the docs linked in this repo.

## Next steps

1. Share the repo link in the program’s Slack channel.
2. Schedule a 15-minute follow-up to capture feedback after the first sprint.
3. Track enhancement ideas in `docs/roadmap.yml` under upcoming weeks.
