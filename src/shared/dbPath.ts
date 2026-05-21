import { existsSync } from 'node:fs';

const DEFAULT_DB_PATH = 'data/nba.duckdb';
const CI_FIXTURE_PATH = 'data/fixtures/nba.ci.duckdb';

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
