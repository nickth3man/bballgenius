import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { closeDb, initDb, query } from '../core/db.js';
import { GameCenterTab } from '../tabs/gameCenter/index.js';
import type { GameShotRow } from '../tabs/gameCenter/queries.js';
import { assertNoAnsiLeaks } from './helpers/ansi.js';
import { loadBoxScoreWithTeamDedup, loadGameShots, loadRecentGames } from './helpers/queries.js';

type BoxScoreRow = { player_id: unknown };

const BOX_SCORE_COLUMNS = [
  'player_id',
  'full_name',
  'team_abbrev',
  'points',
  'assists',
  'reb',
  'steals',
  'blocks',
  'min',
] as const;

const GAME_SHOT_COLUMNS = ['player_id', 'team_id', 'action_type', 'shot_result', 'x', 'y'] as const;

function countPlayerOccurrences(rows: BoxScoreRow[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const id = String(row.player_id);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

async function latestGameId(): Promise<string> {
  const games = await query(`
    SELECT game_id
    FROM dim_game
    ORDER BY game_date DESC
    LIMIT 1
  `);
  expect(games.length).toBe(1);
  return String(games[0].game_id);
}

describe.serial('Game Center box score deduplication', () => {
  beforeAll(async () => {
    await initDb();
  });

  afterAll(async () => {
    await closeDb();
  });

  test('recent dim_game row loads box score via team_dedup SQL', async () => {
    const games = await query(`
      SELECT game_id, game_date
      FROM dim_game
      ORDER BY game_date DESC
      LIMIT 1
    `);

    expect(games.length).toBe(1);

    const gameId = String(games[0].game_id);
    const rows = await loadBoxScoreWithTeamDedup(gameId);

    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).toHaveProperty('player_id');
    expect(rows[0]).toHaveProperty('team_abbrev');
  });

  test('each player_id appears exactly once in box score results', async () => {
    const gameId = await latestGameId();
    const rows = await loadBoxScoreWithTeamDedup(gameId);
    expect(rows.length).toBeGreaterThan(0);

    const counts = countPlayerOccurrences(rows);
    for (const [playerId, count] of counts) {
      expect(count).toBe(1);
      expect(playerId).not.toBe('');
    }
  });

  test('box score row count equals unique player_id count', async () => {
    const gameId = await latestGameId();
    const rows = await loadBoxScoreWithTeamDedup(gameId);
    expect(rows.length).toBeGreaterThan(0);

    const uniquePlayerIds = new Set(rows.map((r) => String(r.player_id)));
    expect(uniquePlayerIds.size).toBe(rows.length);
  });

  test('box score row exposes full stat column shape', async () => {
    const gameId = await latestGameId();
    const rows = await loadBoxScoreWithTeamDedup(gameId);
    expect(rows.length).toBeGreaterThan(0);

    const row = rows[0];
    for (const col of BOX_SCORE_COLUMNS) {
      expect(row).toHaveProperty(col);
    }
  });

  test('loadGameShots row exposes full shot column shape', async () => {
    const games = await loadRecentGames(20);
    expect(games.length).toBeGreaterThan(0);

    let shots: GameShotRow[] = [];
    for (const game of games) {
      const candidate = await loadGameShots(String(game.game_id));
      if (candidate.length > 0) {
        shots = candidate;
        break;
      }
    }
    expect(shots.length).toBeGreaterThan(0);

    const row = shots[0];
    for (const col of GAME_SHOT_COLUMNS) {
      expect(row).toHaveProperty(col);
    }
  });

  test('loadRecentGames(1) returns exactly one row', async () => {
    const games = await loadRecentGames(1);
    expect(games.length).toBe(1);
  });

  test('loadRecentGames(5) returns at most five rows', async () => {
    const games = await loadRecentGames(5);
    expect(games.length).toBeLessThanOrEqual(5);
    expect(games.length).toBeGreaterThan(0);
  });

  test('renderBoxScore shows plain message when boxScores is empty', () => {
    const boxScoreText = { content: '' as string };
    const tab = Object.create(GameCenterTab.prototype) as Record<string, unknown>;
    Object.assign(tab, {
      boxScores: [],
      boxScoreText,
      container: { requestRender: () => {} },
    });

    (tab.renderBoxScore as () => void)();

    const plain = String(boxScoreText.content);
    expect(plain).toContain('No box score data');
    assertNoAnsiLeaks(plain);
  });
});
