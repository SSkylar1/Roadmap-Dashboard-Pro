import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { MigrationDependencies } from "../scripts/migrate-project.mjs";

test("migrateProject copies legacy artifacts into project-aware paths", async () => {
  const moduleUrl = pathToFileURL(path.resolve(__dirname, "../..", "scripts", "migrate-project.mjs"));
  const dynamicImport = new Function(
    "specifier",
    "return import(specifier);",
  ) as <T>(specifier: string) => Promise<T>;
  const migrationModule = await dynamicImport<typeof import("../scripts/migrate-project.mjs")>(moduleUrl.href);

  const repoState = new Map<string, string>([
    ["docs/roadmap.yml", "name: Legacy roadmap"],
    ["docs/roadmap-status.json", "{\"state\":\"ok\"}"],
    ["docs/project-plan.md", "# Legacy plan"],
    [".github/workflows/roadmap.yml", "name: Roadmap"],
    ["docs/roadmap/backlog.md", "- item"],
    ["docs/roadmap/roadmap-status.json", "{\"items\":[]}"],
  ]);

  const treePaths = [
    "docs/roadmap/backlog.md",
    "docs/roadmap/roadmap-status.json",
    "docs/projects/existing/notes.md",
  ];

  const putCalls: Array<{ path: string; content: string; branch: string; message: string }> = [];
  const deleteCalls: string[] = [];

  const dependencies: MigrationDependencies = {
    async getFileRaw(
      _owner: string,
      _repo: string,
      path: string,
      _ref?: string,
      _token?: string,
    ): Promise<string | null> {
      return repoState.has(path) ? repoState.get(path)! : null;
    },
    async putFile(
      _owner: string,
      _repo: string,
      path: string,
      content: string,
      branch: string,
      message: string,
      _token?: string,
    ) {
      putCalls.push({ path, content, branch, message });
      return { path, branch };
    },
    async listRepoTreePaths(
      _owner: string,
      _repo: string,
      _ref?: string,
      _token?: string,
    ): Promise<string[]> {
      return treePaths.slice();
    },
    async deletePath(
      _owner: string,
      _repo: string,
      targetPath: string,
      _options: { token?: string; branch?: string; message?: string | ((path: string) => string) },
    ): Promise<{ deleted: string[]; missing: string[] }> {
      deleteCalls.push(targetPath);
      const normalized = targetPath.replace(/\/+$/, "");
      const deleted: string[] = [];
      for (const candidate of Array.from(repoState.keys())) {
        if (candidate === normalized || candidate.startsWith(`${normalized}/`)) {
          repoState.delete(candidate);
          deleted.push(candidate);
        }
      }
      if (deleted.length === 0) {
        return { deleted: [], missing: [normalized] };
      }
      return { deleted, missing: [] };
    },
  };

  const summary = await migrationModule.migrateProject(
    {
      owner: "acme",
      repo: "demo",
      slug: "Beta Release",
      branch: "main",
      sourceBranch: "main",
      removeLegacy: true,
    },
    dependencies,
  );

  assert.equal(summary.normalizedSlug, "beta-release");
  assert.equal(summary.skipped.length, 0);
  assert.equal(summary.missingLegacy.length, 0);
  assert.deepEqual(deleteCalls.sort(), [
    ".github/workflows/roadmap.yml",
    "docs/project-plan.md",
    "docs/roadmap",
    "docs/roadmap-status.json",
    "docs/roadmap.yml",
  ]);

  const createdTargets = summary.created.map((entry) => entry.target).sort();
  assert.deepEqual(createdTargets, [
    ".github/workflows/roadmap-beta-release.yml",
    "docs/projects/beta-release/project-plan.md",
    "docs/projects/beta-release/roadmap-status.json",
    "docs/projects/beta-release/roadmap.yml",
    "docs/projects/beta-release/roadmap/backlog.md",
    "docs/projects/beta-release/roadmap/roadmap-status.json",
  ]);

  assert.equal(putCalls.length, createdTargets.length);
  assert.ok(putCalls.every((call) => call.branch === "main"));
  assert.ok(summary.created.every((entry) => entry.dryRun === false));
  assert.ok(putCalls[0].message.includes("beta-release"));
});
