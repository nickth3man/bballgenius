import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { closeDb, initDb, query } from '../db.js';
import { ansiToStyledText } from '../utils/formatters.js';
import { styledPlainText } from './helpers/ansi.js';
import {
  loadBoxScoreWithoutTeamDedup,
  loadBoxScoreWithTeamDedup,
  loadGameShots,
  loadGameShotsBrokenFilter,
  loadPlayerAwards,
  loadPlayerAwardsBrokenColumn,
  loadRecentGames,
} from './helpers/queries.js';

const LEBRON_PLAYER_ID = '2544';

function countUniquePlayerIds<T extends { player_id: unknown }>(rows: T[]): number {
  return new Set(rows.map((r) => String(r.player_id))).size;
}

describe('Mutation / break-it verification (Level 1)', () => {
  beforeAll(async () => {
    await initDb();
  });

  afterAll(async () => {
    await closeDb();
  });

  test('correct awards SQL succeeds; award_name column fails (proves regression sensitivity)', async () => {
    const correct = await loadPlayerAwards(LEBRON_PLAYER_ID);
    expect(correct.length).toBeGreaterThan(0);

    let brokenError: Error | null = null;
    try {
      await loadPlayerAwardsBrokenColumn(LEBRON_PLAYER_ID);
    } catch (e: unknown) {
      brokenError = e instanceof Error ? e : new Error(String(e));
    }
    expect(brokenError).not.toBeNull();
    expect(String(brokenError?.message ?? brokenError)).toMatch(
      /award_name|Binder|referenced column/i,
    );
  });

  test('team_dedup box score is unique; undeduped join can duplicate player_id rows', async () => {
    const games = await loadRecentGames(20);
    expect(games.length).toBeGreaterThan(0);

    let foundDuplicateCase = false;

    for (const game of games) {
      const gameId = String(game.game_id);
      const deduped = await loadBoxScoreWithTeamDedup(gameId);
      if (deduped.length === 0) continue;

      const dedupedUnique = countUniquePlayerIds(deduped);
      expect(dedupedUnique).toBe(deduped.length);

      const raw = await loadBoxScoreWithoutTeamDedup(gameId);
      const rawUnique = countUniquePlayerIds(raw);

      if (raw.length > deduped.length || rawUnique < raw.length) {
        foundDuplicateCase = true;
        expect(rawUnique).toBeLessThan(raw.length);
        break;
      }
    }

    expect(foundDuplicateCase).toBe(true);
  });

  test('is_field_goal filter removes non-shot events from loadGameShots', async () => {
    const games = await loadRecentGames(40);
    expect(games.length).toBeGreaterThan(0);

    let gameId: string | null = null;
    let filtered: Awaited<ReturnType<typeof loadGameShots>> = [];
    let unfiltered: Awaited<ReturnType<typeof loadGameShotsBrokenFilter>> = [];

    const fgResultPattern = /made|missed|^1$|^0$/i;

    const tryPair = async (gid: string) => {
      const correct = await loadGameShots(gid);
      const broken = await loadGameShotsBrokenFilter(gid);
      if (correct.length === 0 || broken.length <= correct.length) return false;
      if (!correct.every((row) => fgResultPattern.test(String(row.shot_result)))) {
        return false;
      }
      gameId = gid;
      filtered = correct;
      unfiltered = broken;
      return true;
    };

    for (const game of games) {
      if (await tryPair(String(game.game_id))) break;
    }

    // Recent games may have no non-FG xy events; find any historical game where the filter bites.
    if (!gameId) {
      const candidates = await query(`
        SELECT game_id
        FROM fact_pbp_events
        GROUP BY game_id
        HAVING
          COUNT(*) FILTER (WHERE x IS NOT NULL AND y IS NOT NULL)
          > COUNT(*) FILTER (WHERE is_field_goal = true AND x IS NOT NULL AND y IS NOT NULL)
        ORDER BY game_id ASC
        LIMIT 50
      `);
      for (const row of candidates) {
        if (await tryPair(String(row.game_id))) break;
      }
    }

    expect(gameId).not.toBeNull();
    expect(unfiltered.length).toBeGreaterThan(filtered.length);

    for (const row of filtered) {
      const result = String(row.shot_result);
      expect(result).toMatch(fgResultPattern);
    }
  });

  test('passing ansiToStyledText vs raw string: regression would fail on raw escapes', () => {
    const rawColored = '\x1b[32mMade\x1b[0m /\x1b[31mMiss\x1b[0m';
    const styled = ansiToStyledText(rawColored);
    const plain = styledPlainText(styled);

    expect(plain).toBe('Made /Miss');
    expect(plain).not.toMatch(/\x1b\[/);

    const simulateBugPassThrough = rawColored;
    expect(simulateBugPassThrough).toMatch(/\x1b\[/);
    expect(simulateBugPassThrough).toContain('[32m');
  });

  test('documented guard predicates fail when fed intentionally broken data shapes', () => {
    const correctRows = [
      { player_id: '1', full_name: 'A' },
      { player_id: '2', full_name: 'B' },
    ];
    const buggyRows = [
      { player_id: '1', full_name: 'A' },
      { player_id: '1', full_name: 'A duplicate' },
    ];

    const assertUniquePlayers = (rows: { player_id: unknown }[]) => {
      const ids = rows.map((r) => String(r.player_id));
      expect(new Set(ids).size).toBe(rows.length);
    };

    expect(() => assertUniquePlayers(correctRows)).not.toThrow();
    expect(() => assertUniquePlayers(buggyRows)).toThrow();
  });
});
