import test from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import path from "node:path";

import { __getLastTreeCall, __resetMockGithub } from "./stubs/github";

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

test("projects route short-circuits in standalone mode", async () => {
  const routeSpecifier = "../app/api/projects/[owner]/[repo]/route.js";
  const originalMode = process.env.STANDALONE_MODE;
  process.env.STANDALONE_MODE = "true";
  __resetMockGithub();

  try {
    patchModules();
    const resolved = require.resolve(routeSpecifier);
    delete require.cache[resolved];
    const configResolved = require.resolve("../lib/config.js");
    delete require.cache[configResolved];

    const routeModule = require(routeSpecifier);
    const req = {
      url: "https://example.com/api/projects/acme/demo",
      headers: new Headers(),
    } as unknown as Request;
    const response = await routeModule.GET(req as any, {
      params: { owner: "acme", repo: "demo" },
    });

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body, { projects: [] });
    const treeCall = __getLastTreeCall();
    assert.equal(treeCall, null);
  } finally {
    __resetMockGithub();
    if (originalMode === undefined) {
      delete process.env.STANDALONE_MODE;
    } else {
      process.env.STANDALONE_MODE = originalMode;
    }
    restoreModules();
  }
});
