// app/api/setup/route.ts
import { NextRequest, NextResponse } from "next/server";
import { openSetupPR } from "@/lib/github-pr";
import { getTokenForRepo } from "@/lib/token";

// Ensure Node.js runtime (Octokit/jsonwebtoken need Node, not Edge)
export const runtime = "nodejs";

// -- Helpers -----------------------------------------------------------------
function needEnv(name: string) {
  const v = process.env[name];
  if (!v || v.trim() === "") throw new Error(`Missing env: ${name}`);
  return v;
}
function isValidRepoName(s: string) {
  return /^[A-Za-z0-9._-]+$/.test(s);
}
function isValidOwner(s: string) {
  return /^[A-Za-z0-9-]+$/.test(s);
}
function isLikelyUrl(s: string) {
  try {
    const u = new URL(s);
    return !!u.protocol && !!u.host;
  } catch {
    return false;
  }
}

// -- Route -------------------------------------------------------------------
export async function POST(req: NextRequest) {
  // 1) Validate body early
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const owner = String(body?.owner || "");
  const repo = String(body?.repo || "");
  const branch = String(body?.branch || "");
  const readOnlyUrl = String(body?.readOnlyUrl || "");

  if (!owner || !repo || !branch || !readOnlyUrl) {
    return NextResponse.json({ error: "missing fields: owner, repo, branch, readOnlyUrl" }, { status: 400 });
  }
  if (!isValidOwner(owner)) {
    return NextResponse.json({ error: `invalid owner format: "${owner}"` }, { status: 400 });
  }
  if (!isValidRepoName(repo)) {
    return NextResponse.json({ error: `invalid repo format: "${repo}"` }, { status: 400 });
  }
  if (!isLikelyUrl(readOnlyUrl)) {
    return NextResponse.json({ error: `invalid readOnlyUrl: "${readOnlyUrl}"` }, { status: 400 });
  }

  // 2) Check the envs that GitHub App auth typically needs so we fail with 400 (clear msg)
  try {
    // If your getTokenForRepo reads different names, adjust here
    needEnv("GH_APP_ID");
    // Accept either multiline PEM or base64
    if (!process.env.GH_APP_PRIVATE_KEY && !process.env.GH_APP_PRIVATE_KEY_B64) {
      throw new Error("Missing env: GH_APP_PRIVATE_KEY (or GH_APP_PRIVATE_KEY_B64)");
    }
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 400 });
  }

  // 3) Generate GitHub credentials & open PR with robust error surfacing
  try {
    const auth = await getTokenForRepo(owner, repo);

    const files = [
      {
        path: ".roadmaprc.json",
        content: JSON.stringify(
          {
            // keep schema if your validator expects it; remove if it caused linter warnings elsewhere
            "$schema": "./schema/roadmaprc.schema.json",
            kitVersion: "0.1.1",
            envs: { dev: { READ_ONLY_CHECKS_URL: readOnlyUrl } },
            verify: { symbols: ["ext:pgcrypto"], defaultEnv: "dev" },
            comment: {
              liveProbe: true,
              probeTestPass: false,
              probeSupaFn: false,
              privacyDisclaimer: "🔒 Read-only checks.",
              legendEnabled: true,
            },
          },
          null,
          2
        ),
      },
      {
        path: "docs/roadmap.yml",
        content: [
          "version: 1",
          "weeks:",
          "  - id: w01",
          "    title: Weeks 1–2 — Foundations",
          "    items:",
          "      - id: repo-ci",
          "        name: Repo + CI scaffolding",
          "        checks:",
          "          - type: files_exist",
          "            globs: [\".github/workflows/roadmap.yml\"]",
          "",
        ].join("\n"),
      },
      {
        path: ".github/workflows/roadmap.yml",
        content: [
          "name: Roadmap Sync",
          "on:",
          "  push: { branches: [main] }",
          "  pull_request: {}",
          "  workflow_dispatch: {}",
          "jobs:",
          "  sync:",
          "    runs-on: ubuntu-latest",
          "    permissions: { contents: write }",
          "    env:",
          "      ROADMAP_ENV: dev",
          "    steps:",
          "      - uses: actions/checkout@v4",
          "      - uses: actions/setup-node@v4",
          "        with: { node-version: '20' }",
          "      - run: npm ci || true",
          "      - name: Run checks",
          "        run: |",
          "          node scripts/roadmap-check.mjs",
          "",
        ].join("\n"),
      },
    ];

    const pr = await openSetupPR({
      owner,
      repo,
      auth,
      branch, // e.g. "chore/roadmap-setup"
      files,
      title: "chore(setup): roadmap-kit bootstrap",
      body: "Adds .roadmaprc.json, minimal roadmap, and CI workflow.",
    });

    return NextResponse.json({ ok: true, url: pr?.html_url ?? null, number: pr?.number ?? null });
  } catch (e: any) {
    // Common GitHub/App errors mapped to friendly messages
    const msg = String(e?.message || e);
    let hint: string | undefined;

    if (/PEM routines|invalid pem format|error:0\d+:PEM/i.test(msg)) {
      hint = "Your GH_APP_PRIVATE_KEY looks malformed. Ensure BEGIN/END lines and real newlines (or use GH_APP_PRIVATE_KEY_B64).";
    } else if (/Resource not accessible by integration/i.test(msg)) {
      hint = "The GitHub App likely isn't installed on this repo, or it lacks permissions (Contents: Read & Write, Pull Requests: Read & Write).";
    } else if (/Not Found/i.test(msg) && /repos\/.*\/.*\/git/.test(msg)) {
      hint = "Owner/repo or branch is wrong, or the token doesn't have access.";
    } else if (/Bad credentials|401/i.test(msg)) {
      hint =
        "App JWT or installation token failed—check GH_APP_ID / private key and make sure the app is installed on the repo.";
    } else if (/rate limit/i.test(msg)) {
      hint = "You’ve hit GitHub’s rate limit. Try again in a minute or use an App token instead of PAT.";
    }

    console.error("[/api/setup] error:", msg, e?.stack || "");
    return NextResponse.json({ ok: false, error: msg, hint }, { status: 500 });
  }
}
