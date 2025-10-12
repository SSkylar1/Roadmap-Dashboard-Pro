import test from "node:test";
import assert from "node:assert/strict";

import { mergeProjectOptions } from "../lib/project-options";
import type { RepoProjectSecrets } from "../lib/secrets";

test("includes discovered project slugs when no stored secrets exist", () => {
  const result = mergeProjectOptions(undefined, ["growth-experiments", "launch-pad"]);
  assert.deepEqual(
    result.map((option) => ({ id: option.id, name: option.name, source: option.source })),
    [
      { id: "growth-experiments", name: "growth-experiments", source: "repo" },
      { id: "launch-pad", name: "launch-pad", source: "repo" },
    ],
  );
});

test("dedupes discovered slugs that match stored projects by slug", () => {
  const stored: RepoProjectSecrets[] = [
    { id: "growth-experiments-project-123", name: "Growth Experiments" },
    { id: "weekly-sync", name: "Weekly Sync" },
  ];

  const result = mergeProjectOptions(stored, ["growth-experiments", "weekly-sync", "marketing"]);
  assert.equal(result.length, 3);
  const namesBySource = result.map((option) => `${option.source}:${option.name}`);
  assert.deepEqual(namesBySource, ["stored:Growth Experiments", "stored:Weekly Sync", "repo:marketing"]);
});

test("trims and normalizes discovered slugs", () => {
  const stored: RepoProjectSecrets[] = [];
  const result = mergeProjectOptions(stored, ["  Launch Control  ", "QA"]);
  assert.deepEqual(
    result.map((option) => option.id),
    ["Launch Control", "QA"],
  );
  assert.deepEqual(result.map((option) => option.slug), ["launch-control", "qa"]);
});
