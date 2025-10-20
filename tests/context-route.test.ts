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

test("context route synthesizes standalone payloads", async () => {
  const routeSpecifier = "../app/api/context/[owner]/[repo]/route.js";
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
    source: "title: Demo\n",
    normalized: { title: "Demo", items: [] },
    status: { problems: ["Duplicate id: foo"], counts: { todo: 1 }, total: 1 },
    is_current: true,
  });

  insertStandaloneStatusSnapshot({
    workspace_id: "acme/demo",
    project_id: null,
    branch: "main",
    payload: {
      generated_at: "2024-06-02T12:00:00Z",
      project: null,
      weeks: [{ id: "w1", title: "Week 1", items: [] }],
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
      url: "https://example.com/api/context/acme/demo?branch=main",
      headers: new Headers(),
    } as any;

    const response = await routeModule.GET(request, { params: { owner: "acme", repo: "demo" } });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.source, "standalone");
    assert.equal(payload.repo.owner, "acme");
    assert.equal(payload.repo.name, "demo");
    assert.equal(payload.repo.branch, "main");
    assert.ok(payload.files);
    assert.equal(typeof payload.files["docs/roadmap.yml"], "string");
    assert.ok(payload.files["docs/roadmap.yml"].includes("Demo"));
    assert.equal(typeof payload.files["docs/roadmap-status.json"], "string");
    const statusParsed = JSON.parse(payload.files["docs/roadmap-status.json"]);
    assert.equal(statusParsed.generated_at, "2024-06-02T12:00:00Z");
    assert.ok(payload.files["docs/summary.txt"].includes("Standalone mode"));
    assert.ok(payload.files["docs/backlog-discovered.yml"].includes("Standalone mode"));
    assert.ok(payload.files["docs/tech-stack.yml"].includes("version: 1"));

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
