import test from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import path from "node:path";

import {
  __getLastCall,
  __getLastTreeCall,
  __getPutCalls,
  __resetMockGithub,
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

test("discover route short-circuits in standalone mode", async () => {
  const routeSpecifier = "../app/api/discover/route.js";
  const originalMode = process.env.STANDALONE_MODE;
  process.env.STANDALONE_MODE = "true";

  const { resetStandaloneRoadmapStore, upsertStandaloneWorkspaceRoadmap } = await import(
    "../lib/standalone/roadmaps-store"
  );
  const { resetStandaloneStatusSnapshotStore, insertStandaloneStatusSnapshot } = await import(
    "../lib/standalone/status-snapshots"
  );
  resetStandaloneRoadmapStore();
  resetStandaloneStatusSnapshotStore();

  upsertStandaloneWorkspaceRoadmap({
    workspace_id: "acme/demo",
    title: "Demo Roadmap",
    format: "yaml",
    source: "title: Demo Roadmap\n",
    normalized: { title: "Demo Roadmap", items: [] },
    status: { problems: [], counts: {}, total: 0 },
    is_current: true,
  });

  insertStandaloneStatusSnapshot({
    workspace_id: "acme/demo",
    project_id: null,
    branch: "main",
    payload: {
      generated_at: "2024-06-01T00:00:00Z",
      weeks: [],
    },
  });

  __resetMockGithub();

  try {
    patchModules();
    const resolved = require.resolve(routeSpecifier);
    delete require.cache[resolved];
    const configResolved = require.resolve("../lib/config.js");
    delete require.cache[configResolved];

    const routeModule = require(routeSpecifier);
    const request = {
      headers: new Headers(),
      json: async () => ({ owner: "acme", repo: "demo", branch: "main" }),
    } as any;

    const response = await routeModule.POST(request);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.discovered, 0);
    assert.deepEqual(body.items, []);
    assert.ok(Array.isArray(body.config?.notes));
    assert.ok(body.config.notes.some((note: string) => note.includes("Standalone mode")));
    assert.ok(body.config.notes.some((note: string) => note.includes("Demo Roadmap")));
    assert.ok(body.config.notes.some((note: string) => note.includes("snapshot")));

    assert.equal(__getLastCall(), null);
    assert.equal(__getLastTreeCall(), null);
    assert.equal(__getPutCalls().length, 0);
  } finally {
    __resetMockGithub();
    resetStandaloneRoadmapStore();
    resetStandaloneStatusSnapshotStore();
    if (originalMode === undefined) {
      delete process.env.STANDALONE_MODE;
    } else {
      process.env.STANDALONE_MODE = originalMode;
    }
    restoreModules();
  }
});
