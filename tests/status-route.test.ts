import test from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import path from "node:path";

import {
  __getLastCall,
  __resetMockGithub,
  __setMockResponse,
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

test("status route supports GitHub and standalone modes", async (t) => {
  const routeSpecifier = "../app/api/status/[owner]/[repo]/route.js";

  await t.test("GitHub snapshot path", async () => {
    const originalMode = process.env.STANDALONE_MODE;
    if (originalMode !== undefined) {
      delete process.env.STANDALONE_MODE;
    }
    __resetMockGithub();
    __setMockResponse(
      JSON.stringify({ generated_at: "2024-05-01T00:00:00Z", env: "test", weeks: [] }),
    );

    try {
      patchModules();
      const resolved = require.resolve(routeSpecifier);
      delete require.cache[resolved];
      const configResolved = require.resolve("../lib/config.js");
      delete require.cache[configResolved];
      const routeModule = require(routeSpecifier);
      const req = {
        url: "https://example.com/api/status/Acme/Demo?branch=main&project=Alpha",
        headers: new Headers(),
      } as unknown as Request;
      const response = await routeModule.GET(req as any, {
        params: { owner: "Acme", repo: "Demo" },
      });

      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.project, "alpha");
      assert.equal(body.generated_at, "2024-05-01T00:00:00Z");
      const lastCall = __getLastCall();
      assert.deepEqual(lastCall, {
        owner: "Acme",
        repo: "Demo",
        path: "docs/projects/alpha/roadmap-status.json",
        branch: "main",
        token: undefined,
      });
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

  await t.test("Standalone snapshot path", async () => {
    const originalMode = process.env.STANDALONE_MODE;
    process.env.STANDALONE_MODE = "true";
    __resetMockGithub();

    const { resetStandaloneStatusSnapshotStore, insertStandaloneStatusSnapshot } = await import(
      "../lib/standalone/status-snapshots"
    );
    resetStandaloneStatusSnapshotStore();

    insertStandaloneStatusSnapshot({
      workspace_id: "acme/demo",
      project_id: "alpha",
      branch: "main",
      payload: {
        generated_at: "2024-06-01T00:00:00Z",
        env: "standalone",
        weeks: [{ id: "w1", title: "Week 1", items: [] }],
      },
    });

    try {
      patchModules();
      const resolved = require.resolve(routeSpecifier);
      delete require.cache[resolved];
      const configResolved = require.resolve("../lib/config.js");
      delete require.cache[configResolved];
      const routeModule = require(routeSpecifier);
      const req = {
        url: "https://example.com/api/status/acme/demo?branch=main&project=alpha",
        headers: new Headers(),
      } as unknown as Request;
      const response = await routeModule.GET(req as any, {
        params: { owner: "acme", repo: "demo" },
      });

      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.source, "standalone");
      assert.ok(body.snapshot);
      assert.equal(body.snapshot.project, "alpha");
      assert.equal(body.snapshot.generated_at, "2024-06-01T00:00:00Z");
      assert.deepEqual(body.snapshot.weeks, [{ id: "w1", title: "Week 1", items: [] }]);
      assert.equal(body.meta?.branch, "main");
      assert.equal(body.meta?.project_id, "alpha");
      assert.equal(body.meta?.workspace_id, "acme/demo");
    } finally {
      __resetMockGithub();
      const { resetStandaloneStatusSnapshotStore } = await import(
        "../lib/standalone/status-snapshots"
      );
      resetStandaloneStatusSnapshotStore();
      if (originalMode !== undefined) {
        process.env.STANDALONE_MODE = originalMode;
      } else {
        delete process.env.STANDALONE_MODE;
      }
      restoreModules();
    }
  });
});
