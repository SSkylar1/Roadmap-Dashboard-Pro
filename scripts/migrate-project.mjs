#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import path from "node:path";
import process from "node:process";
import { readFile } from "node:fs/promises";

/**
 * Attempt to import a module normally. If the runtime cannot load TypeScript files directly,
 * fall back to transpiling the module on the fly using the local TypeScript dependency.
 * @param {string} specifier
 */
async function importModule(specifier) {
  const moduleUrl = new URL(specifier, import.meta.url);
  try {
    return await import(moduleUrl.href);
  } catch (error) {
    const code = /** @type {{ code?: string }} */ (error)?.code;
    if (code !== "ERR_MODULE_NOT_FOUND" && code !== "ERR_UNKNOWN_FILE_EXTENSION") {
      throw error;
    }
    const ts = await import("typescript");
    const source = await readFile(fileURLToPath(moduleUrl), "utf8");
    const transpiled = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2020,
      },
      fileName: moduleUrl.pathname,
    });
    const dataUrl = `data:text/javascript;base64,${Buffer.from(transpiled.outputText, "utf8").toString("base64")}`;
    return import(dataUrl);
  }
}

const projectPathsModule = await importModule("../lib/project-paths.ts");
const githubModule = await importModule("../lib/github.ts");

const { projectAwarePath, normalizeProjectKey } = projectPathsModule;
const { getFileRaw, putFile, listRepoTreePaths, deletePath } = githubModule;

const ROOT_ARTIFACTS = [
  "docs/roadmap.yml",
  "docs/roadmap-status.json",
  "docs/project-plan.md",
  ".github/workflows/roadmap.yml",
];

const DIRECTORY_PREFIXES = ["docs/roadmap/"];

const LEGACY_PATHS = [
  "docs/roadmap.yml",
  "docs/roadmap-status.json",
  "docs/project-plan.md",
  ".github/workflows/roadmap.yml",
  "docs/roadmap",
];

/**
 * @typedef {Object} MigrationOptions
 * @property {string} owner
 * @property {string} repo
 * @property {string} slug
 * @property {string} branch
 * @property {string} [sourceBranch]
 * @property {string} [token]
 * @property {boolean} [removeLegacy]
 * @property {boolean} [dryRun]
 * @property {string | ((context: { sourcePath: string; targetPath: string; slug: string; normalizedSlug: string }) => string)} [commitMessage]
 */

/**
 * @typedef {Object} MigrationSummary
 * @property {string} slug
 * @property {string} normalizedSlug
 * @property {{ source: string; target: string; dryRun: boolean }[]} created
 * @property {{ path: string; reason: string }[]} skipped
 * @property {string[]} removedLegacy
 * @property {string[]} missingLegacy
 */

/**
 * @typedef {Object} MigrationDependencies
 * @property {(owner: string, repo: string, path: string, ref?: string, token?: string) => Promise<string | null>} getFileRaw
 * @property {(owner: string, repo: string, path: string, content: string, branch: string, message: string, token?: string) => Promise<unknown>} putFile
 * @property {(owner: string, repo: string, ref?: string, token?: string) => Promise<string[]>} listRepoTreePaths
 * @property {(owner: string, repo: string, targetPath: string, options: { token?: string; branch?: string; message?: string | ((path: string) => string) }) => Promise<{ deleted: string[]; missing: string[] }>} deletePath
 */

const defaultDependencies = {
  getFileRaw,
  putFile,
  listRepoTreePaths,
  deletePath,
};

/**
 * Copy roadmap artifacts for a legacy repository into a project-aware directory.
 * @param {MigrationOptions} options
 * @param {MigrationDependencies} [dependencies]
 * @returns {Promise<MigrationSummary>}
 */
export async function migrateProject(options, dependencies = defaultDependencies) {
  const owner = options.owner?.trim();
  if (!owner) throw new Error("owner is required");
  const repo = options.repo?.trim();
  if (!repo) throw new Error("repo is required");
  const slug = options.slug?.trim();
  if (!slug) throw new Error("slug is required");
  const normalizedSlug = normalizeProjectKey(slug);
  if (!normalizedSlug) throw new Error(`Unable to normalize slug: ${slug}`);
  const branch = options.branch?.trim();
  if (!branch) throw new Error("branch is required");
  const sourceBranch = options.sourceBranch?.trim() || branch;
  const token = options.token?.trim() || undefined;
  const removeLegacy = Boolean(options.removeLegacy);
  const dryRun = Boolean(options.dryRun);

  const treePaths = await dependencies.listRepoTreePaths(owner, repo, sourceBranch, token);

  const candidatePaths = new Set(ROOT_ARTIFACTS);
  for (const prefix of DIRECTORY_PREFIXES) {
    for (const entry of treePaths) {
      if (entry.startsWith(prefix)) {
        candidatePaths.add(entry);
      }
    }
  }

  const created = [];
  const skipped = [];

  const sortedCandidates = Array.from(candidatePaths);
  sortedCandidates.sort();

  for (const sourcePath of sortedCandidates) {
    const content = await dependencies.getFileRaw(owner, repo, sourcePath, sourceBranch, token);
    if (content == null) {
      skipped.push({ path: sourcePath, reason: "missing" });
      continue;
    }
    const targetPath = projectAwarePath(sourcePath, slug);
    if (targetPath === sourcePath) {
      skipped.push({ path: sourcePath, reason: "project-aware path unchanged" });
      continue;
    }
    created.push({ source: sourcePath, target: targetPath, dryRun });
    if (dryRun) continue;
    const commitMessage = resolveCommitMessage(options.commitMessage, {
      sourcePath,
      targetPath,
      slug,
      normalizedSlug,
    });
    await dependencies.putFile(owner, repo, targetPath, content, branch, commitMessage, token);
  }

  const removedLegacy = new Set();
  const missingLegacy = new Set();

  if (removeLegacy && !dryRun) {
    for (const legacyPath of LEGACY_PATHS) {
      const result = await dependencies.deletePath(owner, repo, legacyPath, {
        token,
        branch,
        message: (path) => `chore: remove legacy artifact ${path} (migrated to ${normalizedSlug})`,
      });
      for (const deleted of result.deleted) removedLegacy.add(deleted);
      for (const missing of result.missing) missingLegacy.add(missing);
    }
  }

  return {
    slug,
    normalizedSlug,
    created,
    skipped,
    removedLegacy: Array.from(removedLegacy).sort(),
    missingLegacy: Array.from(missingLegacy).sort(),
  };
}

function resolveCommitMessage(template, context) {
  if (typeof template === "function") {
    const result = template(context);
    if (typeof result === "string" && result.trim()) return result.trim();
  } else if (typeof template === "string" && template.trim()) {
    return template.trim();
  }
  return `chore: migrate ${context.normalizedSlug} from ${context.sourcePath}`;
}

function parseArgv(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const entry = argv[i];
    if (!entry.startsWith("-")) {
      positional.push(entry);
      continue;
    }
    if (entry.startsWith("--no-")) {
      const key = entry.slice(5);
      flags[key] = false;
      continue;
    }
    if (entry.startsWith("--")) {
      const eq = entry.indexOf("=");
      if (eq !== -1) {
        const key = entry.slice(2, eq);
        const value = entry.slice(eq + 1);
        flags[key] = value;
        continue;
      }
      const key = entry.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("-")) {
        flags[key] = next;
        i += 1;
      } else {
        flags[key] = true;
      }
      continue;
    }
    const letters = entry.slice(1);
    for (const letter of letters) {
      flags[letter] = true;
    }
  }
  return { flags, positional };
}

function readBoolean(flags, names, defaultValue) {
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(flags, name)) {
      return Boolean(flags[name]);
    }
  }
  return defaultValue;
}

function resolveOption(flags, names, envVars, fallback) {
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(flags, name)) {
      const value = flags[name];
      if (typeof value === "string") return value;
      if (typeof value === "boolean") return value ? "true" : "";
    }
  }
  for (const envVar of envVars) {
    if (typeof process.env[envVar] === "string" && process.env[envVar]) {
      return process.env[envVar];
    }
  }
  return fallback;
}

function printUsage() {
  console.log(`Usage: node scripts/migrate-project.mjs [options]\n\n` +
    `Required options:\n` +
    `  --slug <name>           Project slug or display name to migrate.\n` +
    `  --owner <org>           GitHub organization or user.\n` +
    `  --repo <name>           Repository name.\n` +
    `Optional flags:\n` +
    `  --branch <name>         Target branch for commits (default: $DEFAULT_BRANCH or main).\n` +
    `  --source-branch <name>  Source branch for reading legacy files (default: branch).\n` +
    `  --remove-legacy         Delete legacy root-level roadmap files after migration.\n` +
    `  --dry-run               Do not write or delete anything; only report actions.\n` +
    `  --token <value>         Explicit GitHub token (defaults to $GITHUB_TOKEN).\n` +
    `  --commit-message <msg>  Custom commit message for all migrated files.\n` +
    `  --help                  Show this message.\n`);
}

async function main() {
  const { flags, positional } = parseArgv(process.argv.slice(2));
  if (flags.h || flags.help) {
    printUsage();
    return;
  }

  if (!flags.slug && positional.length > 0) {
    flags.slug = positional[0];
  }

  const slug = resolveOption(flags, ["slug", "project", "s"], ["ROADMAP_PROJECT", "PROJECT_SLUG"], "").trim();
  if (!slug) {
    console.error("Missing required --slug option");
    printUsage();
    process.exitCode = 1;
    return;
  }

  const owner = resolveOption(flags, ["owner", "o"], ["REPO_OWNER", "GITHUB_OWNER"], "").trim();
  if (!owner) {
    console.error("Missing required --owner option");
    printUsage();
    process.exitCode = 1;
    return;
  }

  const repo = resolveOption(flags, ["repo", "r"], ["REPO_NAME"], "").trim();
  if (!repo) {
    console.error("Missing required --repo option");
    printUsage();
    process.exitCode = 1;
    return;
  }

  const branch = resolveOption(flags, ["branch", "b"], ["DEFAULT_BRANCH"], "main").trim() || "main";
  const sourceBranch = resolveOption(flags, ["source-branch", "sourceBranch"], ["SOURCE_BRANCH"], branch).trim() || branch;
  const token = resolveOption(flags, ["token", "t"], ["GITHUB_TOKEN"], "").trim();
  const removeLegacy = readBoolean(flags, ["remove-legacy", "removeLegacy", "delete-legacy", "deleteLegacy"], false);
  const keepLegacy = readBoolean(flags, ["keep-legacy", "keepLegacy"], false);
  const dryRun = readBoolean(flags, ["dry-run", "dryRun"], false);
  const commitMessageOption = resolveOption(flags, ["commit-message", "commitMessage"], [], "");
  const commitMessage = commitMessageOption.trim() ? commitMessageOption.trim() : undefined;

  const finalRemove = removeLegacy && !keepLegacy;

  const summary = await migrateProject({
    owner,
    repo,
    slug,
    branch,
    sourceBranch,
    token: token || undefined,
    removeLegacy: finalRemove,
    dryRun,
    commitMessage,
  });

  console.log(`Migrated ${summary.slug} → ${summary.normalizedSlug}`);
  if (summary.created.length === 0) {
    console.log("No artifacts migrated (nothing to copy or all files missing).");
  } else {
    console.log("Created/updated files:");
    for (const entry of summary.created) {
      const marker = entry.dryRun ? "(dry-run)" : "";
      console.log(`  ${entry.source} -> ${entry.target} ${marker}`.trim());
    }
  }

  if (summary.skipped.length > 0) {
    console.log("Skipped:");
    for (const skip of summary.skipped) {
      console.log(`  ${skip.path} (${skip.reason})`);
    }
  }

  if (finalRemove) {
    if (summary.removedLegacy.length > 0) {
      console.log("Removed legacy files:");
      for (const removed of summary.removedLegacy) {
        console.log(`  ${removed}`);
      }
    }
    if (summary.missingLegacy.length > 0) {
      console.log("Legacy files already missing:");
      for (const missing of summary.missingLegacy) {
        console.log(`  ${missing}`);
      }
    }
  }
}

const isMain = fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? "");
if (isMain) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

