import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { enrichWeeks } from "../app/api/status-live/enrich-weeks";

test("enrichWeeks preserves legacy results arrays", async () => {
  const fixturePath = path.resolve(__dirname, "..", "..", "tests", "fixtures", "status-legacy.json");
  const raw = fs.readFileSync(fixturePath, "utf8");
  const json = JSON.parse(raw);

  const weeks = await enrichWeeks(json.weeks, {
    owner: "acme",
    repo: "demo",
    branch: "main",
    token: undefined,
    rc: null,
    mode: "artifact",
    runCheck: async () => {
      throw new Error("runCheck should not be invoked in artifact mode");
    },
  });

  assert.equal(weeks.length, 1);
  const item = weeks[0]?.items?.[0];
  assert.ok(item, "expected an item");

  assert.equal(item.checks.length, 2);
  assert.equal(item.results, item.checks);

  const [first, second] = item.checks;
  assert.equal(first.ok, true);
  assert.equal(first.status, "pass");
  assert.equal(first.result, "pass");

  assert.equal(second.ok, false);
  assert.equal(second.status, "fail");
  assert.equal(second.result, "fail");

  assert.equal(item.done, false);
});
