# Roadmap Dashboard in 30 Minutes

**Goal:** equip a new initiative with the roadmap dashboard, automation, and docs in
under half an hour.

## TL;DR

- Create a repo from the template and wire up credentials in minutes.
- Run the roadmap checks so CI immediately reflects the new team’s setup.
- Demo the dashboard and capture next steps before the half-hour is over.

## Who this is for

- Engineering managers who need transparent roadmap execution.
- Program leads accountable for cross-team alignment.
- Developer advocates onboarding partners to roadmap-kit.

## Why it matters

- Centralizes roadmap progress, documentation, and automation in one repo.
- Reduces setup time from days to minutes by reusing the bootstrap template.
- Keeps delivery predictable through automated checklist enforcement.

## What you need before starting

- GitHub permissions to create repositories inside the organization.
- The roadmap-kit GitHub App (or a temporary PAT) ready for authentication.
- Node.js 20+, npm, and the ability to run the verification script locally.
- The Slack/Teams channel where you will share the dashboard link afterward.

## Step-by-step plan

### 0–5 min — Create the space

1. **Create the repo** using the bootstrap template (`Use this template → Create`).
2. **Name it** following the agreed `<team>-roadmap-dashboard` convention.
3. **Invite the core team** (manager, tech lead, and primary engineer) so they receive
   notifications from the start.

### 5–15 min — Configure locally

4. **Install dependencies** locally: `npm install` then copy `.env.example` to `.env.local`.
5. **Configure credentials** with either the GitHub App (preferred) or a short-lived PAT.
6. **Update `.roadmaprc.json`** with the correct `READ_ONLY_CHECKS_URL` for your Supabase
   Edge function (or equivalent read-only verifier).

### 15–25 min — Align the roadmap

7. **Edit `docs/roadmap.yml`** to reflect the actual initiatives and dependent files.
8. **Run `npm run roadmap:check`** to validate files exist before pushing your first branch.
9. **Commit & push** so the Roadmap Checks workflow runs and updates the status badge.

### 25–30 min — Demo and hand-off

10. **Open the dashboard** at `npm run dev` → http://localhost:3000/new and walk through the
    onboarding wizard with the stakeholders.
11. **Log immediate follow-ups** (missing files, doc gaps, new automation ideas) in the
    roadmap backlog before everyone leaves the room.

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
