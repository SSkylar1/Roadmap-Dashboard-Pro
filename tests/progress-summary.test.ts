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
    if (request === "next/link") {
      const stub = path.join(compiledRoot, "tests", "stubs", "next-link.js");
      return originalResolveFilename.call(this, stub, parent, isMain, options);
    }
    if (request === "next/navigation") {
      const stub = path.join(compiledRoot, "tests", "stubs", "next-navigation.js");
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

test("boolean-only roadmap items emit implicit progress checks", async () => {
  patchModules();
  try {
    const module = await import("../app/page.js");
    const { resolveProgressSnapshot, summarizeItemProgress, summarizeWeekProgress, itemStatus, statusText } =
      module as any;

    const doneTrue = resolveProgressSnapshot(undefined, undefined, true);
    assert.equal(doneTrue.total, 1);
    assert.equal(doneTrue.passed, 1);
    assert.equal(doneTrue.failed, 0);
    assert.equal(doneTrue.pending, 0);
    assert.equal(doneTrue.progressPercent, 100);

    const doneFalse = resolveProgressSnapshot(undefined, undefined, false);
    assert.equal(doneFalse.total, 1);
    assert.equal(doneFalse.passed, 0);
    assert.equal(doneFalse.failed, 1);
    assert.equal(doneFalse.pending, 0);
    assert.equal(doneFalse.progressPercent, 0);

    const doneUnknown = resolveProgressSnapshot(undefined, undefined, undefined);
    assert.equal(doneUnknown.total, 1);
    assert.equal(doneUnknown.passed, 0);
    assert.equal(doneUnknown.failed, 0);
    assert.equal(doneUnknown.pending, 1);
    assert.equal(doneUnknown.progressPercent, 0);

    const itemSummary = summarizeItemProgress({ id: "task-1", name: "Task", done: true });
    assert.deepEqual(itemSummary, doneTrue);

    const weekSummary = summarizeWeekProgress({
      id: "week-1",
      title: "Week 1",
      items: [
        { id: "task-1", name: "Complete setup", done: true },
        { id: "task-2", name: "Review plan", done: false },
      ],
    } as any);

    assert.equal(weekSummary.total, 2);
    assert.equal(weekSummary.passed, 1);
    assert.equal(weekSummary.failed, 1);
    assert.equal(weekSummary.pending, 0);
    assert.equal(weekSummary.progressPercent, 50);

    const progressOnlyItem = {
      id: "task-3",
      name: "Legacy progress snapshot",
      progress: { total: 4, passed: 4, failed: 0, pending: 0 },
    } as any;
    const progressSummary = summarizeItemProgress(progressOnlyItem);
    assert.equal(progressSummary.total, 4);
    assert.equal(progressSummary.failed, 0);
    assert.equal(progressSummary.pending, 0);

    const okStatus = itemStatus(progressOnlyItem);
    assert.equal(okStatus, true);

    const badgeLabel = statusText(okStatus, progressSummary.total > 0);
    assert.equal(badgeLabel, "Complete");
  } finally {
    restoreModules();
  }
});
