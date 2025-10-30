import type { DeletePathOptions, DeletePathResult } from "../lib/github";

export interface CommitMessageContext {
  sourcePath: string;
  targetPath: string;
  slug: string;
  normalizedSlug: string;
}

export type CommitMessageTemplate =
  | string
  | ((context: CommitMessageContext) => string);

export interface MigrationOptions {
  owner: string;
  repo: string;
  slug: string;
  branch: string;
  sourceBranch?: string;
  token?: string;
  removeLegacy?: boolean;
  dryRun?: boolean;
  commitMessage?: CommitMessageTemplate;
}

export interface MigrationSummary {
  slug: string;
  normalizedSlug: string;
  created: Array<{ source: string; target: string; dryRun: boolean }>;
  skipped: Array<{ path: string; reason: string }>;
  removedLegacy: string[];
  missingLegacy: string[];
}

export interface MigrationDependencies {
  getFileRaw: (
    owner: string,
    repo: string,
    path: string,
    ref?: string,
    token?: string,
  ) => Promise<string | null>;
  putFile: (
    owner: string,
    repo: string,
    path: string,
    content: string,
    branch: string,
    message: string,
    token?: string,
  ) => Promise<unknown>;
  listRepoTreePaths: (
    owner: string,
    repo: string,
    ref?: string,
    token?: string,
  ) => Promise<string[]>;
  deletePath: (
    owner: string,
    repo: string,
    targetPath: string,
    options: DeletePathOptions,
  ) => Promise<DeletePathResult>;
}

export declare function migrateProject(
  options: MigrationOptions,
  dependencies?: MigrationDependencies,
): Promise<MigrationSummary>;
