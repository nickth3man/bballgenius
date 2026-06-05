import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/**
 * Walks up the directory tree from `process.cwd()` looking for a `package.json`
 * that declares `"workspaces"` — the marker for the monorepo root. The default
 * DB and CI fixture paths are anchored to that root, so the resolver is
 * independent of which package the caller was launched from.
 */
function findRepoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    const pkgPath = join(dir, 'package.json');
    if (existsSync(pkgPath)) {
      try {
        const contents = readFileSync(pkgPath, 'utf-8');
        if (/"workspaces"\s*:/.test(contents)) return dir;
      } catch {
        // Unreadable or non-text file — keep walking.
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break; // Hit the filesystem root.
    dir = parent;
  }
  return process.cwd();
}

const REPO_ROOT = findRepoRoot();
const DEFAULT_DB_PATH = resolve(REPO_ROOT, 'data/nba.duckdb');
const CI_FIXTURE_PATH = resolve(REPO_ROOT, 'data/fixtures/nba.ci.duckdb');

export function resolveDbPath(): string {
  const configuredPath = process.env['NBA_DUCKDB_PATH'];
  if (configuredPath) {
    return configuredPath;
  }
  if (
    (process.env['CI'] === 'true' || process.env['GITHUB_ACTIONS'] === 'true') &&
    existsSync(CI_FIXTURE_PATH)
  ) {
    return CI_FIXTURE_PATH;
  }
  return DEFAULT_DB_PATH;
}
