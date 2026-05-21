import { describe, expect, mock, test } from 'bun:test';

describe('buildSystemPrompt', () => {
  test('describes the replaced database canonical schema', async () => {
    mock.module('../db.js', () => ({
      getTableRefs: async () => [
        { schema: 'main', name: 'fact_game', type: 'BASE TABLE', qualifiedName: 'fact_game' },
        {
          schema: 'main',
          name: 'fact_player_award_vote',
          type: 'BASE TABLE',
          qualifiedName: 'fact_player_award_vote',
        },
        {
          schema: 'stg_bref',
          name: 'player_totals',
          type: 'BASE TABLE',
          qualifiedName: 'stg_bref.player_totals',
        },
      ],
      getColumns: async (table: string) => {
        if (table === 'main.fact_game') {
          return [
            { name: 'game_id', type: 'VARCHAR' },
            { name: 'season_type', type: 'VARCHAR' },
          ];
        }
        return [
          { name: 'person_id', type: 'BIGINT' },
          { name: 'award', type: 'VARCHAR' },
          { name: 'winner', type: 'BOOLEAN' },
        ];
      },
    }));

    const { buildSystemPrompt } = await import('../systemPrompt.js');
    const prompt = await buildSystemPrompt();

    expect(prompt).toContain('fact_game');
    expect(prompt).toContain('person_id');
    expect(prompt).toContain("season_type = 'Regular'");
    expect(prompt).toContain('Schema: stg_bref');
    expect(prompt).toContain('All schemas are');
    expect(prompt).toContain('fact_bref_player_season_totals');
    expect(prompt).toContain('fact_player_award_vote');
    expect(prompt).toContain('2TM');
    expect(prompt).not.toContain('dim_game (games)');
    expect(prompt).not.toContain('fact_box_score');
  });
});
