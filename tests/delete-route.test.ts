import test from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import path from "node:path";

import {
  __getDeleteCalls,
  __resetMockGithub,
  __setMockDeleteImplementation,
} from "./stubs/github";

const originalResolveFilename: any = (Module as any)._resolveFilename;

function patchModules() {
  const compiledRoot = path.resolve(__dirname, "..");
  (Module as any)._resolveFilename = function patchedResolve(
    request: string,
    parent: unknown,
    isMain: boolean,
    options: unknown,
  ) {
    if (request === "@/lib/github") {
      const stub = path.join(compiledRoot, "tests", "stubs", "github.js");
      return originalResolveFilename.call(this, stub, parent, isMain, options);
    }
    if (request.startsWith("@/")) {
      const resolved = path.join(compiledRoot, request.slice(2));
      return originalResolveFilename.call(this, resolved, parent, isMain, options);
    }
    return originalResolveFilename.call(this, request, parent, isMain, options);
  };
}

function restoreModules() {
  (Module as any)._resolveFilename = originalResolveFilename;
}

test("delete route removes shared and project-scoped artifacts", async () => {
  const routeSpecifier = "../app/api/projects/[owner]/[repo]/delete/route.js";
  const originalMode = process.env.STANDALONE_MODE;
  if (originalMode !== undefined) {
    delete process.env.STANDALONE_MODE;
  }

  const expectedTargets = [
    ".github/workflows/roadmap-beta-release.yml",
    "docs/projects/beta-release",
    "docs/projects/beta-release/backlog-discovered.yml",
    "docs/projects/beta-release/discover.yml",
    "docs/projects/beta-release/gtm-plan.md",
    "docs/projects/beta-release/idea-log.md",
    "docs/projects/beta-release/infra-facts.md",
    "docs/projects/beta-release/project-plan.md",
    "docs/projects/beta-release/roadmap",
    "docs/projects/beta-release/roadmap-status.json",
    "docs/projects/beta-release/roadmap/project-plan.md",
    "docs/projects/beta-release/roadmap/roadmap-status.json",
    "docs/projects/beta-release/roadmap.yml",
    "docs/projects/beta-release/summary.txt",
    "docs/projects/beta-release/tech-stack.yml",
  ];

  const repoState = new Set(expectedTargets);

  __resetMockGithub();
  __setMockDeleteImplementation(async (_owner, _repo, targetPath) => {
    const normalized = targetPath.replace(/\/+$/, "");
    const deleted: string[] = [];
    for (const entry of Array.from(repoState)) {
      if (entry === normalized || entry.startsWith(`${normalized}/`)) {
        repoState.delete(entry);
        deleted.push(entry);
      }
    }
    if (deleted.length === 0) {
      return { deleted: [], missing: [normalized] };
    }
    return { deleted, missing: [] };
  });

  try {
    patchModules();
    const resolved = require.resolve(routeSpecifier);
    delete require.cache[resolved];
    const configResolved = require.resolve("../lib/config.js");
    delete require.cache[configResolved];

    const routeModule = require(routeSpecifier);
    const headers = new Headers();
    headers.set("x-github-pat", "secret-token");

    const request = {
      headers,
      json: async () => ({ project: "Beta Release", branch: "main" }),
    } as unknown as Request;

    const response = await routeModule.POST(request, {
      params: { owner: "acme", repo: "demo" },
    });

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.project, "beta-release");
    assert.equal(payload.branch, "main");
    assert.deepEqual(payload.missing, []);
    assert.deepEqual(payload.deleted, expectedTargets.slice().sort());

    const deleteCalls = __getDeleteCalls();
    assert.equal(deleteCalls.length, expectedTargets.length);
    const calledPaths = deleteCalls.map((call) => call.path).sort();
    assert.deepEqual(calledPaths, expectedTargets.slice().sort());
    for (const call of deleteCalls) {
      assert.equal(call.owner, "acme");
      assert.equal(call.repo, "demo");
      assert.equal(call.options.branch, "main");
      assert.equal(call.options.token, "secret-token");
      assert.equal(typeof call.options.message, "function");
    }

    assert.equal(repoState.size, 0);
  } finally {
    __resetMockGithub();
    if (originalMode !== undefined) {
      process.env.STANDALONE_MODE = originalMode;
    } else {
      delete process.env.STANDALONE_MODE;
    }
    restoreModules();
  }
});
