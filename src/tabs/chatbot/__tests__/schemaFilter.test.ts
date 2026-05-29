import { describe, expect, mock, test } from 'bun:test';

describe('buildIntentSchemaPrompt', () => {
  test('returns null for general intent', async () => {
    mock.module('../db.js', () => ({
      getTableRefs: async () => [],
      getColumns: async () => [],
    }));

    const { buildIntentSchemaPrompt } = await import('../agent/schemaFilter.js');
    const result = await buildIntentSchemaPrompt('general');

    expect(result).toBeNull();
  });

  test('returns null for cross_schema intent', async () => {
    mock.module('../db.js', () => ({
      getTableRefs: async () => [],
      getColumns: async () => [],
    }));

    const { buildIntentSchemaPrompt } = await import('../agent/schemaFilter.js');
    const result = await buildIntentSchemaPrompt('cross_schema');

    expect(result).toBeNull();
  });

  test('returns null for unknown intent category', async () => {
    mock.module('../db.js', () => ({
      getTableRefs: async () => [],
      getColumns: async () => [],
    }));

    const { buildIntentSchemaPrompt } = await import('../agent/schemaFilter.js');
    const result = await buildIntentSchemaPrompt('nonexistent_category');

    expect(result).toBeNull();
  });

  test('builds prompt for career_leaders intent', async () => {
    mock.module('../db.js', () => ({
      getTableRefs: async () => [
        {
          schema: 'main',
          name: 'fact_bref_player_season_totals',
          type: 'BASE TABLE',
          qualifiedName: 'fact_bref_player_season_totals',
        },
        {
          schema: 'main',
          name: 'dim_player',
          type: 'BASE TABLE',
          qualifiedName: 'dim_player',
        },
      ],
      getColumns: async (table: string) => {
        if (table.includes('fact_bref_player_season_totals')) {
          return [
            { name: 'player_name', type: 'VARCHAR' },
            { name: 'pts', type: 'INTEGER' },
            { name: 'team', type: 'VARCHAR' },
          ];
        }
        return [
          { name: 'person_id', type: 'BIGINT' },
          { name: 'player_name', type: 'VARCHAR' },
        ];
      },
    }));

    const { buildIntentSchemaPrompt } = await import('../agent/schemaFilter.js');
    const result = await buildIntentSchemaPrompt('career_leaders');

    expect(result).not.toBeNull();
    expect(result).toContain('Focus on these tables');
    expect(result).toContain('fact_bref_player_season_totals');
    expect(result).toContain('player_name');
    expect(result).toContain('SQL templates for common patterns');
    expect(result).toContain('Career total for stat across players');
  });

  test('builds prompt for awards intent', async () => {
    mock.module('../db.js', () => ({
      getTableRefs: async () => [
        {
          schema: 'main',
          name: 'fact_player_award_vote',
          type: 'BASE TABLE',
          qualifiedName: 'fact_player_award_vote',
        },
        {
          schema: 'main',
          name: 'dim_player',
          type: 'BASE TABLE',
          qualifiedName: 'dim_player',
        },
      ],
      getColumns: async (table: string) => {
        if (table.includes('fact_player_award_vote')) {
          return [
            { name: 'award', type: 'VARCHAR' },
            { name: 'winner', type: 'BOOLEAN' },
            { name: 'vote_points_share', type: 'DOUBLE' },
          ];
        }
        return [{ name: 'player_name', type: 'VARCHAR' }];
      },
    }));

    const { buildIntentSchemaPrompt } = await import('../agent/schemaFilter.js');
    const result = await buildIntentSchemaPrompt('awards');

    expect(result).not.toBeNull();
    expect(result).toContain('fact_player_award_vote');
    expect(result).toContain('Award winner');
    expect(result).toContain('vote_points_share');
  });

  test('builds prompt for games intent', async () => {
    mock.module('../db.js', () => ({
      getTableRefs: async () => [
        {
          schema: 'main',
          name: 'fact_game',
          type: 'BASE TABLE',
          qualifiedName: 'fact_game',
        },
        {
          schema: 'main',
          name: 'fact_player_game_stats',
          type: 'BASE TABLE',
          qualifiedName: 'fact_player_game_stats',
        },
      ],
      getColumns: async (table: string) => {
        if (table.includes('fact_game')) {
          return [
            { name: 'game_id', type: 'VARCHAR' },
            { name: 'season_type', type: 'VARCHAR' },
          ];
        }
        return [
          { name: 'points', type: 'INTEGER' },
          { name: 'reb', type: 'INTEGER' },
          { name: 'assists', type: 'INTEGER' },
        ];
      },
    }));

    const { buildIntentSchemaPrompt } = await import('../agent/schemaFilter.js');
    const result = await buildIntentSchemaPrompt('games');

    expect(result).not.toBeNull();
    expect(result).toContain('fact_game');
    expect(result).toContain('Box score');
    expect(result).toContain('points');
  });

  test('truncates column list when exceeding limit', async () => {
    mock.module('../db.js', () => ({
      getTableRefs: async () => [
        {
          schema: 'main',
          name: 'fact_bref_player_season_totals',
          type: 'BASE TABLE',
          qualifiedName: 'fact_bref_player_season_totals',
        },
      ],
      getColumns: async () => {
        const columns = [];
        for (let i = 0; i < 30; i++) {
          columns.push({ name: `col_${i}`, type: 'VARCHAR' });
        }
        return columns;
      },
    }));

    const { buildIntentSchemaPrompt } = await import('../agent/schemaFilter.js');
    const result = await buildIntentSchemaPrompt('career_leaders');

    expect(result).not.toBeNull();
    expect(result).toContain('more columns');
  });

  test('uses schema priority for table qualification', async () => {
    mock.module('../db.js', () => ({
      getTableRefs: async () => [
        {
          schema: 'stg_bref',
          name: 'player_totals',
          type: 'BASE TABLE',
          qualifiedName: 'stg_bref.player_totals',
        },
        {
          schema: 'main',
          name: 'player_totals',
          type: 'BASE TABLE',
          qualifiedName: 'player_totals',
        },
      ],
      getColumns: async () => [{ name: 'player_name', type: 'VARCHAR' }],
    }));

    const { buildIntentSchemaPrompt } = await import('../agent/schemaFilter.js');
    const result = await buildIntentSchemaPrompt('career_leaders');

    expect(result).not.toBeNull();
    expect(result).toContain('main.player_totals');
  });

  test('includes SQL templates for shot_charts intent', async () => {
    mock.module('../db.js', () => ({
      getTableRefs: async () => [
        {
          schema: 'main',
          name: 'fact_shot_chart',
          type: 'BASE TABLE',
          qualifiedName: 'fact_shot_chart',
        },
      ],
      getColumns: async () => [
        { name: 'x', type: 'DOUBLE' },
        { name: 'y', type: 'DOUBLE' },
        { name: 'shot_made', type: 'BOOLEAN' },
      ],
    }));

    const { buildIntentSchemaPrompt } = await import('../agent/schemaFilter.js');
    const result = await buildIntentSchemaPrompt('shot_charts');

    expect(result).not.toBeNull();
    expect(result).toContain('Shot chart');
    expect(result).toContain('shot_zone');
  });

  test('includes closing instruction', async () => {
    mock.module('../db.js', () => ({
      getTableRefs: async () => [
        {
          schema: 'main',
          name: 'fact_play_by_play',
          type: 'BASE TABLE',
          qualifiedName: 'fact_play_by_play',
        },
      ],
      getColumns: async () => [
        { name: 'period', type: 'INTEGER' },
        { name: 'event_type', type: 'VARCHAR' },
      ],
    }));

    const { buildIntentSchemaPrompt } = await import('../agent/schemaFilter.js');
    const result = await buildIntentSchemaPrompt('play_by_play');

    expect(result).not.toBeNull();
    expect(result).toContain('Start by using these tables directly');
    expect(result).toContain('get_schema_info');
  });
});
