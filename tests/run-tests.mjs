#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const tmpDir = path.join(projectRoot, ".tmp-tests");

function run(command, args, message) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    cwd: projectRoot,
  });

  if (result.error) {
    if (result.error.code === "ENOENT") {
      console.error(`Failed to run ${command}: command not found.`);
    } else {
      console.error(`Failed to run ${command}:`, result.error.message);
    }
    process.exit(1);
  }

  if (result.status !== 0) {
    if (message) {
      console.error(message);
    }
    process.exit(result.status ?? 1);
  }
}

function resolveTscBin() {
  const binName = process.platform === "win32" ? "tsc.cmd" : "tsc";
  const candidate = path.join(projectRoot, "node_modules", ".bin", binName);
  if (fs.existsSync(candidate)) {
    return candidate;
  }
  return binName;
}

fs.rmSync(tmpDir, { recursive: true, force: true });

const tscBin = resolveTscBin();
run(tscBin, ["-p", "tsconfig.tests.json"], "TypeScript compilation for tests failed.");

const compiledTestsDir = path.join(tmpDir, "tests");

if (!fs.existsSync(compiledTestsDir)) {
  console.error(
    `No compiled tests found at ${path.relative(projectRoot, compiledTestsDir)}. ` +
      "Ensure your tests are included in tsconfig.tests.json.",
  );
  process.exit(1);
}

function collectTestFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTestFiles(fullPath));
    } else if (entry.isFile() && /\.(test|spec)\.(cjs|mjs|js)$/i.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

const testFiles = collectTestFiles(compiledTestsDir);
if (testFiles.length === 0) {
  console.error(
    `No compiled test files ending in .test.js were generated in ${path.relative(
      projectRoot,
      compiledTestsDir,
    )}.`,
  );
  process.exit(1);
}

const extraArgs = process.argv.slice(2);
run(
  process.execPath,
  ["--test", ...extraArgs, ...testFiles],
  "Node.js reported test failures.",
);
