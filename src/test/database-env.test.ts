// @vitest-environment node

import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  databaseEnvCandidates,
  loadDatabaseTestEnvironment,
} from "./database-env";

const temporaryDirectories: string[] = [];
const originalDatabaseUrl = process.env.DATABASE_URL;

function temporaryDirectory() {
  const directory = mkdtempSync(join(tmpdir(), "kazeos-database-env-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("database integration environment", () => {
  it("discovers the checkout env first and the main repository env from a worktree", () => {
    const repository = temporaryDirectory();
    const gitDirectory = join(repository, ".git");
    const worktree = join(repository, ".worktrees", "expense-planning");
    const worktreeGitDirectory = join(gitDirectory, "worktrees", "expense-planning");
    mkdirSync(worktreeGitDirectory, { recursive: true });
    mkdirSync(worktree, { recursive: true });
    writeFileSync(join(worktree, ".git"), `gitdir: ${worktreeGitDirectory}\n`);
    writeFileSync(join(worktreeGitDirectory, "commondir"), "../..\n");

    expect(databaseEnvCandidates(worktree).slice(0, 2)).toEqual([
      resolve(worktree, ".env.local"),
      resolve(repository, ".env.local"),
    ]);
  });

  it("loads checkout values before fallback values", () => {
    const repository = temporaryDirectory();
    const worktree = join(repository, ".worktrees", "expense-planning");
    mkdirSync(worktree, { recursive: true });
    writeFileSync(join(worktree, ".env.local"), "DATABASE_URL=postgres://checkout/database\n");
    writeFileSync(join(repository, ".env.local"), "DATABASE_URL=postgres://repository/database\n");
    delete process.env.DATABASE_URL;

    expect(loadDatabaseTestEnvironment(worktree)).toBe(
      "postgres://checkout/database",
    );
  });

  it("throws instead of silently skipping when an env file lacks DATABASE_URL", () => {
    const repository = temporaryDirectory();
    writeFileSync(join(repository, ".env.local"), "APP_ORIGIN=http://localhost:3000\n");
    delete process.env.DATABASE_URL;

    expect(() => loadDatabaseTestEnvironment(repository)).toThrow(
      "DATABASE_URL",
    );
  });
});
