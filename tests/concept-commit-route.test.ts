import test from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import path from "node:path";

import { __getPutCalls, __resetMockGithub, __setMockResponse } from "./stubs/github";

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

test("concept commit route requires roadmap setup", async () => {
  const routeSpecifier = "../app/api/concept/commit/route.js";
  __resetMockGithub();
  __setMockResponse({
    default: null,
    ".roadmaprc.json": null,
    ".github/workflows/roadmap.yml": null,
    "scripts/roadmap-check.mjs": null,
  });

  try {
    patchModules();
    const resolved = require.resolve(routeSpecifier);
    delete require.cache[resolved];
    const routeModule = require(routeSpecifier);

    const request = {
      url: "https://example.com/api/concept/commit",
      headers: new Headers(),
      json: async () => ({
        owner: "acme",
        repo: "demo",
        branch: "main",
        content: "weeks: []",
      }),
    } as any;

    const response = await routeModule.POST(request);
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.code, "missing_roadmap_setup");
    assert.equal(body.setupUrl, "/new");
    assert.ok(Array.isArray(body.missing));
    assert.deepEqual(
      body.missing.sort(),
      [".github/workflows/roadmap.yml", ".roadmaprc.json", "scripts/roadmap-check.mjs"].sort(),
    );
    assert.equal(__getPutCalls().length, 0);
  } finally {
    __resetMockGithub();
    restoreModules();
  }
});

test("concept commit route succeeds when setup files exist", async () => {
  const routeSpecifier = "../app/api/concept/commit/route.js";
  __resetMockGithub();
  __setMockResponse({
    ".roadmaprc.json": "{}",
    ".github/workflows/roadmap.yml": "name: Roadmap",
    "scripts/roadmap-check.mjs": "export const noop = () => {};",
  });

  try {
    patchModules();
    const resolved = require.resolve(routeSpecifier);
    delete require.cache[resolved];
    const routeModule = require(routeSpecifier);

    const request = {
      url: "https://example.com/api/concept/commit",
      headers: new Headers(),
      json: async () => ({
        owner: "acme",
        repo: "demo",
        branch: "main",
        content: "weeks:\n  - id: test\n",
      }),
    } as any;

    const response = await routeModule.POST(request);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.path, "docs/roadmap.yml");
    const puts = __getPutCalls();
    assert.equal(puts.length, 1);
    assert.equal(puts[0].path, "docs/roadmap.yml");
    assert.equal(puts[0].owner, "acme");
    assert.equal(puts[0].repo, "demo");
  } finally {
    __resetMockGithub();
    restoreModules();
  }
});
