import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { closeDb, initDb } from '../core/db.js';
import { closeHonorsDb } from '../core/dbHonors.js';
import { loadPlayerAwards } from '../tabs/timeMachine/queries.js';
import { groupPlayerAwards } from '../tabs/timeMachine/utils/awards.js';
import { seasonEndYearToNbaLabel } from '../tabs/timeMachine/utils/seasonYear.js';

const HONORS_DB = process.env.NBA_HONORS_DUCKDB_PATH?.trim();
const HONORS_AVAILABLE = Boolean(HONORS_DB && existsSync(HONORS_DB));

describe('seasonEndYearToNbaLabel', () => {
  test('maps end year to NBA season string', () => {
    expect(seasonEndYearToNbaLabel(2013)).toBe('2012-13');
    expect(seasonEndYearToNbaLabel(2009)).toBe('2008-09');
  });
});

describe('optional honors database', () => {
  afterAll(async () => {
    await closeHonorsDb();
    await closeDb();
  });

  test('loads LeBron MVPs from basketball-data honors DB when configured', async () => {
    if (!HONORS_AVAILABLE) {
      expect(true).toBe(true);
      return;
    }

    process.env.NBA_DUCKDB_PATH = process.env.NBA_DUCKDB_PATH ?? 'data/fixtures/nba.ci.duckdb';
    await initDb();

    const awards = await loadPlayerAwards('2544');
    const grouped = groupPlayerAwards(awards);
    const mvp = grouped.find((g) => g.award === 'nba mvp');

    expect(mvp).toBeDefined();
    expect(mvp!.seasons).toHaveLength(4);
    expect(mvp!.seasons.sort()).toEqual(['2008-09', '2009-10', '2011-12', '2012-13']);
  });
});
