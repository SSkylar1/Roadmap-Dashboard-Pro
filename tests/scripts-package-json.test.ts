import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const scriptsPackagePath = path.resolve(__dirname, "..", "..", "scripts", "package.json");

test("scripts/package.json is valid JSON with roadmap:check script", () => {
  const contents = fs.readFileSync(scriptsPackagePath, "utf8");
  const parsed = JSON.parse(contents) as { scripts?: Record<string, string> };

  assert.ok(parsed && typeof parsed === "object", "package.json should parse to an object");
  assert.equal(
    parsed.scripts?.["roadmap:check"],
    "node scripts/roadmap-check.mjs",
    "roadmap:check script should be present",
  );
});
