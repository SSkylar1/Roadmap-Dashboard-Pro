import { NextRequest, NextResponse } from "next/server";
import { openSetupPR } from "@/lib/github-pr";
import { getTokenForRepo } from "@/lib/token";

export async function POST(req: NextRequest) {
  try {
    const { owner, repo, branch, readOnlyUrl } = await req.json();
    if (!owner || !repo || !branch || !readOnlyUrl) return NextResponse.json({ error: "missing fields" }, { status: 400 });

    const token = await getTokenForRepo(owner, repo);

    const files = [
      {
        path: ".roadmaprc.json",
        content: JSON.stringify({
          "$schema": "./schema/roadmaprc.schema.json",
          "kitVersion": "0.1.1",
          "envs": { "dev": { "READ_ONLY_CHECKS_URL": readOnlyUrl } },
          "verify": { "symbols": ["ext:pgcrypto"], "defaultEnv": "dev" },
          "comment": { "liveProbe": true, "probeTestPass": false, "probeSupaFn": false, "privacyDisclaimer": "🔒 Read-only checks.", "legendEnabled": true }
        }, null, 2)
      },
      {
        path: "docs/roadmap.yml",
        content: "version: 1\nweeks:\n  - id: w01\n    title: Weeks 1–2 — Foundations\n    items:\n      - id: repo-ci\n        name: Repo + CI scaffolding\n        checks:\n          - type: files_exist\n            globs: ['.github/workflows/roadmap.yml']\n"
      },
      {
        path: ".github/workflows/roadmap.yml",
        content: "name: Roadmap Sync\non:\n  push: { branches: [main] }\n  pull_request: {}\n  workflow_dispatch: {}\njobs:\n  sync:\n    runs-on: ubuntu-latest\n    permissions: { contents: write }\n    env:\n      ROADMAP_ENV: dev\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-node@v4\n        with: { node-version: '20' }\n      - run: npm ci || true\n      - name: Run checks\n        run: |\n          node scripts/roadmap-check.mjs\n"
      }
    ];

    const pr = await openSetupPR({
      owner, repo, token, branch,
      files,
      title: "chore(setup): roadmap-kit bootstrap",
      body: "Adds .roadmaprc.json, minimal roadmap, and CI workflow."
    });

    return NextResponse.json({ url: pr.html_url || null, number: pr.number || null });
  } catch (e:any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
