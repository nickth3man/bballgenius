import { describe, expect, test } from 'bun:test';
import { classifyQuestion } from '../agent/graph.js';

describe('classifyQuestion', () => {
  test('classifies career leader questions', () => {
    expect(classifyQuestion('Who are the top 5 NBA regular season career points leaders?')).toBe(
      'career_leaders',
    );
    expect(classifyQuestion('What are LeBron James career points?')).toBe('career_leaders');
    expect(classifyQuestion('How many regular season triple-doubles does Jokic have?')).toBe(
      'career_leaders',
    );
    expect(classifyQuestion('Which players have the most 50-point games?')).toBe('career_leaders');
  });

  test('classifies season leader questions', () => {
    expect(classifyQuestion('Who led the NBA in points per game in 2015-16?')).toBe(
      'season_leaders',
    );
    expect(classifyQuestion('What was Stephen Curry 2015-16 points per game?')).toBe(
      'season_leaders',
    );
    expect(classifyQuestion('Which players averaged at least 30 points per game?')).toBe(
      'season_leaders',
    );
  });

  test('classifies award questions', () => {
    expect(classifyQuestion('Who won NBA MVP in the 2023-24 season?')).toBe('awards');
    expect(classifyQuestion('Who won NBA Rookie of the Year?')).toBe('awards');
    expect(classifyQuestion('Which players were All-NBA First Team?')).toBe('awards');
  });

  test('classifies team season questions', () => {
    expect(
      classifyQuestion('What was the 2015-16 Golden State Warriors regular season record?'),
    ).toBe('team_seasons');
    expect(classifyQuestion('What was the Celtics record and SRS?')).toBe('team_seasons');
  });

  test('classifies game questions', () => {
    expect(classifyQuestion('What was the final score of 2016 NBA Finals Game 7?')).toBe('games');
    expect(classifyQuestion('What was LeBron James stat line in game_id 0041500407?')).toBe(
      'games',
    );
  });

  test('classifies shot chart questions', () => {
    expect(classifyQuestion('How many three pointer did Curry make in shot chart data?')).toBe(
      'shot_charts',
    );
    expect(classifyQuestion('What was LeBron James shot distribution by zone?')).toBe(
      'shot_charts',
    );
  });

  test('classifies play-by-play questions', () => {
    expect(classifyQuestion('How many turnovers are in the play-by-play data?')).toBe(
      'play_by_play',
    );
    expect(classifyQuestion('How many made shots are in play-by-play?')).toBe('play_by_play');
  });

  test('classifies identity questions', () => {
    expect(classifyQuestion('What Basketball-Reference ID is linked to LeBron James?')).toBe(
      'identity',
    );
    expect(classifyQuestion('What NBA API person_id is linked to Michael Jordan?')).toBe(
      'identity',
    );
    expect(classifyQuestion('Which players are unresolved in the identity bridge?')).toBe(
      'identity',
    );
  });

  test('classifies draft questions', () => {
    expect(classifyQuestion('Who was selected first overall in the 2003 NBA draft?')).toBe('draft');
    expect(classifyQuestion('Compare draft pick via BRef and NBA API tables.')).toBe('draft');
  });

  test('classifies data quality questions', () => {
    expect(classifyQuestion('What data quality issues are in audit.dq_results?')).toBe(
      'data_quality',
    );
  });

  test('classifies cross-schema questions', () => {
    expect(
      classifyQuestion('Cross-check 2016 Finals Game 7 score between main and unified_star.'),
    ).toBe('cross_schema');
  });

  test('classifies general/unmatched questions', () => {
    expect(classifyQuestion('Tell me about basketball')).toBe('general');
    expect(classifyQuestion('What is the NBA?')).toBe('general');
  });

  test('classifies via context-rich questions', () => {
    expect(classifyQuestion('Using the api schema, show LeBron James recent game log rows.')).toBe(
      'general',
    );
  });
});
