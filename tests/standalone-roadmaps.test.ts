import test from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import path from "node:path";

import type { StandaloneRoadmapRecord } from "../lib/standalone/roadmaps-store";

const yamlSource = `title: Demo Roadmap\nphases:\n  - name: Discovery\n    items:\n      - id: task-1\n        title: Kickoff meeting\n        status: todo\n`;

test("standalone ingestion and check routes succeed", async () => {
  const originalMode = process.env.STANDALONE_MODE;
  process.env.STANDALONE_MODE = "true";

  const storeModule = await import("../lib/standalone/roadmaps-store");
  const { resetStandaloneRoadmapStore, getStandaloneRoadmap } = storeModule;
  resetStandaloneRoadmapStore();

  const compiledRoot = path.resolve(__dirname, "..");
  const originalResolveFilename = (Module as any)._resolveFilename as (
    request: string,
    parent: unknown,
    isMain: boolean,
    options: unknown,
  ) => string;

  try {

    (Module as any)._resolveFilename = function patchedResolve(
      request: string,
      parent: unknown,
      isMain: boolean,
      options: unknown,
    ) {
      if (request === "@supabase/supabase-js") {
        const stub = path.join(compiledRoot, "tests", "stubs", "supabase.js");
        return originalResolveFilename.call(this, stub, parent, isMain, options);
      }
      if (request.startsWith("@/")) {
        const resolved = path.join(compiledRoot, request.slice(2));
        return originalResolveFilename.call(this, resolved, parent, isMain, options);
      }
      return originalResolveFilename.call(this, request, parent, isMain, options);
    };

    const ingestModule = await import("../app/api/roadmaps/ingest/route");
    const checksModule = await import("../app/api/roadmaps/[id]/checks/route");

    const ingestResponse = await ingestModule.POST({
      json: async () => ({
        workspaceId: "ws-1",
        format: "yaml" as const,
        source: yamlSource,
      }),
    } as any);

    assert.equal(ingestResponse.status, 200);

    const ingestJson = (await ingestResponse.json()) as {
      ok: boolean;
      roadmap?: StandaloneRoadmapRecord;
    };

    assert.equal(ingestJson.ok, true);
    assert.ok(ingestJson.roadmap);
    const roadmapId = ingestJson.roadmap!.id;

    const storedBefore = getStandaloneRoadmap(roadmapId);
    assert.ok(storedBefore, "expected roadmap to be stored");
    assert.equal(storedBefore.status.total, 1);
    assert.deepEqual(storedBefore.status.problems, []);

    const checkResponse = await checksModule.POST({} as any, { params: { id: roadmapId } });
    assert.equal(checkResponse.status, 200);

    const checkJson = (await checkResponse.json()) as {
      ok: boolean;
      status: StandaloneRoadmapRecord["status"];
    };

    assert.equal(checkJson.ok, true);
    assert.equal(checkJson.status.total, 1);
    const storedAfter = getStandaloneRoadmap(roadmapId);
    assert.ok(storedAfter, "expected roadmap to remain stored");
    assert.deepEqual(storedAfter.status, checkJson.status);
    assert.notEqual(storedAfter.updated_at, storedBefore.updated_at);
  } finally {
    (Module as any)._resolveFilename = originalResolveFilename;
    resetStandaloneRoadmapStore();
    if (originalMode === undefined) {
      delete process.env.STANDALONE_MODE;
    } else {
      process.env.STANDALONE_MODE = originalMode;
    }
  }
});
