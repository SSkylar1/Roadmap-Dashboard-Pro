# New Repository Bootstrap Template

This template codifies the defaults we rely on for roadmap-kit projects. Use it to
spin up a repo with everything in place for the dashboard, automation, and docs.

## Why the template exists

- Guarantees the `.roadmaprc.json` + roadmap YAML scaffolding is present.
- Ships with a verified GitHub Actions pipeline so roadmap checks run on every PR.
- Bundles the baseline Next.js dashboard app so teams can start iterating on week one.

## Prerequisites

1. GitHub organization permissions to create repositories.
2. GitHub App installation (or a PAT with `repo` scope) for roadmap-kit automation.
3. Node.js 20+ installed locally for running the dashboard and roadmap scripts.

## Creating a project from the template

1. Open the template repository in GitHub and choose **Use this template → Create a new repository**.
2. Name the repository following the `<team>-roadmap-dashboard` convention.
3. Leave **Include all branches** unchecked; we only need the default branch.
4. Create the repository.

## Post-creation tasks

1. Clone the new repository locally:
   ```bash
   git clone git@github.com:<org>/<repo>.git
   cd <repo>
   npm install
   ```
2. Copy `.env.example` to `.env.local` and fill in the GitHub App or PAT credentials.
3. Update `.roadmaprc.json` with the correct `READ_ONLY_CHECKS_URL` endpoint for the team.
4. Run the roadmap validation script to confirm the baseline files are in place:
   ```bash
   npm run roadmap:check
   ```
   - If your roadmap files live under `docs/projects/<slug>/`, set `ROADMAP_PROJECT=<slug>` before running the command. The generated GitHub Actions workflow now exports this variable automatically when a project key is provided.
5. Push the initial commit to GitHub and ensure the **Roadmap Sync** workflow passes.

## Customizing for your team

- Update `docs/roadmap.yml` with the milestones relevant to the initiative.
- Tweak the dashboard copy in `app/page.tsx` and supporting components.
- If the repo needs additional CI, add new workflows alongside `roadmap.yml`.

## Maintenance tips

- Keep the template branch up to date with changes from `main` to avoid drift.
- When adding features to the dashboard, backport worthwhile improvements into the template.
- Document any manual steps in this file so future adopters can follow the same playbook.
