import test from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import path from "node:path";

const originalResolveFilename: any = (Module as any)._resolveFilename;

function patchModules() {
  const compiledRoot = path.resolve(__dirname, "..");
  (Module as any)._resolveFilename = function patchedResolve(
    request: string,
    parent: unknown,
    isMain: boolean,
    options: unknown,
  ) {
    if (request === "@/lib/github-pr") {
      const stub = path.join(compiledRoot, "tests", "stubs", "github-pr.js");
      return originalResolveFilename.call(this, stub, parent, isMain, options);
    }
    if (request === "@/lib/token") {
      const stub = path.join(compiledRoot, "tests", "stubs", "token.js");
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

test("setup route writes project-aware roadmap path when slug provided", async () => {
  const routeSpecifier = "../app/api/setup/route.js";
  const compiledRoot = path.resolve(__dirname, "..");
  const githubPrStubPath = path.join(compiledRoot, "tests", "stubs", "github-pr.js");
  const tokenStubPath = path.join(compiledRoot, "tests", "stubs", "token.js");

  const githubPrStub = require(githubPrStubPath);
  githubPrStub.__resetOpenSetupStub();

  const originalFetch = global.fetch;
  global.fetch = async (input: any, init?: any) => {
    const url = typeof input === "string" ? input : input?.url;
    if (typeof url !== "string") {
      throw new Error("Unexpected fetch call");
    }
    if (url.startsWith("https://api.github.com/repos/") && !url.includes("/contents/")) {
      const body = JSON.stringify({ default_branch: "main" });
      return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.includes("/contents/")) {
      return new Response("Not Found", { status: 404, headers: { "content-type": "application/json" } });
    }
    return new Response("", { status: 200, headers: { "content-type": "application/json" } });
  };

  const originalEnv = {
    GH_APP_ID: process.env.GH_APP_ID,
    GH_APP_PRIVATE_KEY: process.env.GH_APP_PRIVATE_KEY,
    GH_APP_PRIVATE_KEY_B64: process.env.GH_APP_PRIVATE_KEY_B64,
  };
  process.env.GH_APP_ID = "stub-app";
  process.env.GH_APP_PRIVATE_KEY = "stub-key";
  delete process.env.GH_APP_PRIVATE_KEY_B64;

  try {
    patchModules();
    const resolved = require.resolve(routeSpecifier);
    delete require.cache[resolved];

    const routeModule = require(routeSpecifier);
    const request = new Request("https://example.com/api/setup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        owner: "acme",
        repo: "demo",
        branch: "chore/setup",
        readOnlyUrl: "https://example.com/read-only",
        projectSlug: "Beta Launch",
      }),
    });

    const response = await routeModule.POST(request);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.ok, true);

    const call = githubPrStub.__getLastOpenSetupCall();
    assert.ok(call, "openSetupPR should be invoked");
    const roadmapFile = call.files.find((file: any) => file.path.includes("roadmap.yml") && !file.path.includes("workflow"));
    assert.ok(roadmapFile, "roadmap.yml should be part of the payload");
    assert.equal(roadmapFile.path, "docs/projects/beta-launch/roadmap.yml");
  } finally {
    restoreModules();
    global.fetch = originalFetch;
    if (originalEnv.GH_APP_ID === undefined) delete process.env.GH_APP_ID;
    else process.env.GH_APP_ID = originalEnv.GH_APP_ID;
    if (originalEnv.GH_APP_PRIVATE_KEY === undefined) delete process.env.GH_APP_PRIVATE_KEY;
    else process.env.GH_APP_PRIVATE_KEY = originalEnv.GH_APP_PRIVATE_KEY;
    if (originalEnv.GH_APP_PRIVATE_KEY_B64 === undefined) delete process.env.GH_APP_PRIVATE_KEY_B64;
    else process.env.GH_APP_PRIVATE_KEY_B64 = originalEnv.GH_APP_PRIVATE_KEY_B64;
    githubPrStub.__resetOpenSetupStub();
    delete require.cache[githubPrStubPath];
    delete require.cache[tokenStubPath];
  }
});
