import test from "node:test";
import assert from "node:assert/strict";

import { extractCheckResult } from "../lib/read-only-probe";

test("extractCheckResult supports string success values", () => {
  const payload = {
    checks: {
      "foo.check": "allowed",
      "bar.check": { status: "pass" },
    },
  };

  assert.equal(extractCheckResult("foo.check", payload), true);
  assert.equal(extractCheckResult("bar.check", payload), true);
});

test("extractCheckResult supports status flags inside arrays", () => {
  const payload = {
    results: [
      { query: "alpha", status: "ok" },
      { name: "beta", result: "passed" },
      { identifier: "gamma", allowed: "success" },
    ],
  };

  assert.equal(extractCheckResult("alpha", payload), true);
  assert.equal(extractCheckResult("beta", payload), true);
  assert.equal(extractCheckResult("gamma", payload), true);
});
