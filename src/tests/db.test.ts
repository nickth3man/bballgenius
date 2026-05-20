import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { closeDb, getColumns, getTables, initDb, query } from '../db.js';

describe('DuckDB Integration', () => {
  beforeAll(async () => {
    await initDb();
  });

  afterAll(async () => {
    await closeDb();
  });

  test('should execute a simple query successfully', async () => {
    const res = await query('SELECT 1 + 1 AS sum');
    expect(res.length).toBe(1);
    expect(res[0].sum).toBe(2);
  });

  test('should retrieve tables from schema', async () => {
    const tables = await getTables();
    expect(tables.length).toBeGreaterThan(0);

    // Check key historical/factual tables are listed
    expect(tables).toContain('dim_player');
    expect(tables).toContain('dim_game');
    expect(tables).toContain('dim_team');
    expect(tables).toContain('fact_player_awards');
    expect(tables).toContain('fact_player_season_stats');
    expect(tables).toContain('fact_player_game_boxscore');
    expect(tables).toContain('fact_pbp_events');
  });

  test('should retrieve columns for dim_player successfully', async () => {
    const columns = await getColumns('dim_player');
    expect(columns.length).toBeGreaterThan(0);
    expect(columns[0].type).toBeTruthy();

    const colNames = columns.map((c) => c.name);
    expect(colNames).toContain('player_id');
    expect(colNames).toContain('full_name');
    expect(colNames).toContain('from_year');
    expect(colNames).toContain('height_inches');
    expect(colNames).toContain('body_weight_lbs');
    expect(colNames).toContain('draft_year');
    expect(colNames).toContain('draft_round');
    expect(colNames).toContain('draft_number');
    expect(colNames).toContain('birth_date');
    expect(colNames).toContain('country');
    expect(colNames).toContain('school');
    expect(colNames).toContain('to_year');
    expect(colNames).toContain('is_active');
  });

  test('should retrieve columns for fact_player_awards and verify "award" exists instead of "award_name"', async () => {
    const columns = await getColumns('fact_player_awards');
    const colNames = columns.map((c) => c.name);

    expect(colNames).toContain('award');
    expect(colNames).not.toContain('award_name'); // Verifies the fix for the Binder Error!
  });
});
