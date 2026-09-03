import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

import { config } from "dotenv";

function resolveGitDirectory(checkoutRoot: string): string | undefined {
  const marker = resolve(checkoutRoot, ".git");
  if (!existsSync(marker)) return undefined;
  if (statSync(marker).isDirectory()) return marker;

  const match = /^gitdir:\s*(.+)$/m.exec(readFileSync(marker, "utf8"));
  if (!match) return undefined;
  return isAbsolute(match[1])
    ? resolve(match[1])
    : resolve(checkoutRoot, match[1]);
}

function resolveMainRepositoryRoot(checkoutRoot: string): string | undefined {
  const gitDirectory = resolveGitDirectory(checkoutRoot);
  if (!gitDirectory) return undefined;
  const commonDirectoryFile = resolve(gitDirectory, "commondir");
  const commonGitDirectory = existsSync(commonDirectoryFile)
    ? resolve(gitDirectory, readFileSync(commonDirectoryFile, "utf8").trim())
    : gitDirectory;
  return dirname(commonGitDirectory);
}

export function databaseEnvCandidates(checkoutRoot: string): string[] {
  const candidates = [resolve(checkoutRoot, ".env.local")];
  const mainRepositoryRoot = resolveMainRepositoryRoot(checkoutRoot);
  if (mainRepositoryRoot) {
    candidates.push(resolve(mainRepositoryRoot, ".env.local"));
  }
  candidates.push(resolve(checkoutRoot, "../..", ".env.local"));
  return [...new Set(candidates)];
}

export function loadDatabaseTestEnvironment(
  checkoutRoot = process.cwd(),
): string | undefined {
  const envFiles = databaseEnvCandidates(checkoutRoot).filter(existsSync);
  for (const path of envFiles) config({ path, quiet: true });

  const databaseUrl = process.env.DATABASE_URL;
  if (envFiles.length > 0 && !databaseUrl) {
    throw new Error(
      "A repository .env.local exists but DATABASE_URL could not be loaded",
    );
  }
  return databaseUrl;
}
