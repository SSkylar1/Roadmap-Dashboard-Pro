import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeProjectKey,
  projectAwarePath,
  describeProjectFile,
  inferProjectsFromPaths,
} from "../lib/project-paths";

test("normalizeProjectKey sanitizes project names", () => {
  assert.equal(normalizeProjectKey("  My Fancy_Project!!  "), "my-fancy-project");
  assert.equal(normalizeProjectKey(""), undefined);
  assert.equal(normalizeProjectKey(null), undefined);
});

test("inferProjectsFromPaths deduplicates and sorts project keys", () => {
  const paths = [
    "docs/projects/Foo/readme.md",
    "docs/roadmap.md",
    ".github/workflows/roadmap.yml",
    ".github/workflows/roadmap-bar.yml",
    "docs/projects/foo/changelog.md",
    "unrelated/file.txt",
  ];

  const projects = inferProjectsFromPaths(paths);
  assert.deepEqual(projects, [null, "bar", "foo"]);
});

test("projectAwarePath maps shared artifacts to project-aware equivalents", () => {
  assert.equal(
    projectAwarePath("docs/roadmap.md", "Beta Release"),
    "docs/projects/beta-release/roadmap.md",
  );

  assert.equal(
    projectAwarePath(".github/workflows/roadmap.yml", "Beta Release"),
    ".github/workflows/roadmap-beta-release.yml",
  );

  assert.equal(projectAwarePath("docs/notes.md", null), "docs/notes.md");
});

test("describeProjectFile mirrors projectAwarePath output", () => {
  assert.equal(
    describeProjectFile("docs/roadmap-status.json", "Alpha"),
    "docs/projects/alpha/roadmap-status.json",
  );
  assert.equal(describeProjectFile("README.md", "Alpha"), "README.md");
});
