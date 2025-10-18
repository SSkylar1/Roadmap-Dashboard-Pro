import assert from "node:assert/strict";
import test from "node:test";
import yaml from "js-yaml";

import { normalizeRoadmapYaml } from "../lib/roadmap-normalize";

test("normalizeRoadmapYaml preserves well-formed docs", () => {
  const input = [
    "version: 1",
    "weeks:",
    "  - id: w1",
    "    title: Week 1",
    "    items:",
    "      - id: setup",
    "        name: Initial setup",
    "        checks:",
    "          - type: files_exist",
    "            files:",
    "              - README.md",
  ].join("\n");

  const normalized = normalizeRoadmapYaml(input);
  const doc = yaml.load(normalized) as any;

  assert.equal(doc.version, 1);
  assert.equal(doc.weeks.length, 1);
  assert.equal(doc.weeks[0].id, "w1");
  assert.equal(doc.weeks[0].items[0].checks[0].type, "files_exist");
  assert.deepEqual(doc.weeks[0].items[0].checks[0].files, ["README.md"]);
});

test("normalizeRoadmapYaml derives weeks from roadmap phases", () => {
  const input = [
    "roadmap:",
    "  - phase: Foundations",
    "    milestones:",
    "      - week: 1-2",
    "        title: Bootstrap",
    "        tasks:",
    "          - Create repo",
    "          - task: Configure CI",
    "            checks:",
    "              - type: files_exist",
    "                files: [package.json, package-lock.json]",
  ].join("\n");

  const normalized = normalizeRoadmapYaml(input);
  const doc = yaml.load(normalized) as any;

  assert.equal(doc.version, 1);
  assert.equal(doc.weeks.length, 1);
  assert.match(doc.weeks[0].title, /Foundations/);
  assert.equal(doc.weeks[0].items.length, 2);
  const manualItem = doc.weeks[0].items[0];
  assert.equal(manualItem.name, "Create repo");
  assert.equal(manualItem.manual, true);
  const checkItem = doc.weeks[0].items[1];
  assert.equal(checkItem.name, "Configure CI");
  assert.equal(checkItem.checks[0].type, "files_exist");
  assert.deepEqual(checkItem.checks[0].files, ["package.json", "package-lock.json"]);
});

test("normalizeRoadmapYaml normalizes shorthand checks", () => {
  const input = [
    "weeks:",
    "  - title: Launch",
    "    items:",
    "      - name: Publish status endpoint",
    "        checks:",
    "          - https://example.com/status",
    "          - type: http_ok",
    "            url: https://example.com/status",
    "            mustMatch: [\"OK\"]",
  ].join("\n");

  const normalized = normalizeRoadmapYaml(input);
  const doc = yaml.load(normalized) as any;
  const checks = doc.weeks[0].items[0].checks;

  assert.equal(checks.length, 2);
  assert.equal(checks[0].type, "http_ok");
  assert.equal(checks[0].url, "https://example.com/status");
  assert.equal(checks[1].type, "http_ok");
  assert.deepEqual(checks[1].must_match, ["OK"]);
});

