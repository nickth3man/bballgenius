export interface NbaEvalQuery {
  id: string;
  category: string;
  question: string;
  expectedTools?: string[];
  expectNoSqlError?: boolean;
}

export const NBA_100_QUERIES: NbaEvalQuery[] = [
  {
    id: 'career-001',
    category: 'career leaders',
    question: 'Who are the top 5 NBA regular season career points leaders?',
  },
  {
    id: 'career-002',
    category: 'career leaders',
    question: 'Who are the top 5 NBA regular season career assists leaders?',
  },
  {
    id: 'career-003',
    category: 'career leaders',
    question: 'Who are the top 5 NBA regular season career rebounds leaders?',
  },
  {
    id: 'career-004',
    category: 'career leaders',
    question: 'Who are the top 5 NBA regular season career steals leaders?',
  },
  {
    id: 'career-005',
    category: 'career leaders',
    question: 'Who are the top 5 NBA regular season career blocks leaders?',
  },
  {
    id: 'career-006',
    category: 'career leaders',
    question: 'Who are the top 5 NBA regular season career made three pointers leaders?',
  },
  {
    id: 'career-007',
    category: 'career leaders',
    question: 'Who are the top 5 NBA regular season career free throw leaders?',
  },
  {
    id: 'career-008',
    category: 'career leaders',
    question: 'Who are the top 5 NBA regular season career games played leaders?',
  },
  {
    id: 'career-009',
    category: 'career leaders',
    question: 'What are LeBron James regular season career points, rebounds, and assists?',
    expectedTools: ['query_nba_db'],
    expectNoSqlError: true,
  },
  {
    id: 'career-010',
    category: 'career leaders',
    question: 'What are Michael Jordan regular season career points, rebounds, and assists?',
  },
  {
    id: 'career-011',
    category: 'career leaders',
    question: 'What are Kareem Abdul-Jabbar regular season career points and rebounds?',
  },
  {
    id: 'career-012',
    category: 'career leaders',
    question:
      'How many regular season triple-doubles does Nikola Jokic have in the game box score data?',
    expectedTools: ['query_nba_db'],
    expectNoSqlError: true,
  },
  {
    id: 'career-013',
    category: 'career leaders',
    question:
      'How many regular season triple-doubles does LeBron James have in the game box score data?',
  },
  {
    id: 'career-014',
    category: 'career leaders',
    question: 'Which players have the most regular season 50-point games in the database?',
  },
  {
    id: 'career-015',
    category: 'career leaders',
    question: 'Which players have the most regular season games with at least 20 assists?',
  },
  {
    id: 'season-001',
    category: 'season leaders',
    question: 'Who led the NBA in points per game in the 2015-16 season?',
  },
  {
    id: 'season-002',
    category: 'season leaders',
    question: 'Who led the NBA in assists per game in the 2019-20 season?',
  },
  {
    id: 'season-003',
    category: 'season leaders',
    question: 'Who led the NBA in rebounds per game in the 2020-21 season?',
  },
  {
    id: 'season-004',
    category: 'season leaders',
    question: 'Who led the NBA in blocks per game in the 2018-19 season?',
  },
  {
    id: 'season-005',
    category: 'season leaders',
    question: 'Who led the NBA in steals per game in the 2016-17 season?',
  },
  {
    id: 'season-006',
    category: 'season leaders',
    question: 'What was Stephen Curry 2015-16 regular season points per game?',
  },
  {
    id: 'season-007',
    category: 'season leaders',
    question: 'What was James Harden 2018-19 regular season points per game?',
  },
  {
    id: 'season-008',
    category: 'season leaders',
    question: 'What was Russell Westbrook 2016-17 regular season triple-double count?',
  },
  {
    id: 'season-009',
    category: 'season leaders',
    question: 'What was Wilt Chamberlain 1961-62 regular season points per game?',
  },
  {
    id: 'season-010',
    category: 'season leaders',
    question: 'Which players averaged at least 30 points per game in the 2022-23 NBA season?',
  },
  {
    id: 'season-011',
    category: 'season leaders',
    question: 'Which players averaged at least 10 assists per game in the 2021-22 NBA season?',
  },
  {
    id: 'season-012',
    category: 'season leaders',
    question: 'Which players averaged at least 12 rebounds per game in the 2023-24 NBA season?',
  },
  {
    id: 'season-013',
    category: 'season leaders',
    question: 'Which NBA players had the highest PER in the 2008-09 season?',
  },
  {
    id: 'season-014',
    category: 'season leaders',
    question: 'Which NBA players had the highest win shares in the 2012-13 season?',
  },
  {
    id: 'season-015',
    category: 'season leaders',
    question: 'Which NBA players had the highest BPM in the 2023-24 season?',
  },
  {
    id: 'awards-001',
    category: 'awards',
    question: 'Who won NBA MVP in the 2023-24 season?',
    expectedTools: ['query_nba_db'],
    expectNoSqlError: true,
  },
  { id: 'awards-002', category: 'awards', question: 'Who won NBA MVP in the 2022-23 season?' },
  {
    id: 'awards-003',
    category: 'awards',
    question: 'Who won NBA Rookie of the Year in the 2023-24 season?',
  },
  {
    id: 'awards-004',
    category: 'awards',
    question: 'Who won NBA Defensive Player of the Year in the 2022-23 season?',
  },
  {
    id: 'awards-005',
    category: 'awards',
    question: 'Who finished top 3 in NBA MVP voting in the 2020-21 season?',
  },
  {
    id: 'awards-006',
    category: 'awards',
    question: 'What was Nikola Jokic MVP vote share in the 2023-24 season?',
  },
  {
    id: 'awards-007',
    category: 'awards',
    question: 'What was Joel Embiid MVP vote share in the 2022-23 season?',
  },
  {
    id: 'awards-008',
    category: 'awards',
    question: 'Which players were All-NBA First Team in the 2023-24 season?',
  },
  {
    id: 'awards-009',
    category: 'awards',
    question: 'Which players were All-Defensive First Team in the 2022-23 season?',
  },
  {
    id: 'awards-010',
    category: 'awards',
    question: 'Which players were selected as All-Stars in the 2023-24 season?',
  },
  {
    id: 'team-001',
    category: 'team seasons',
    question: 'What was the 2015-16 Golden State Warriors regular season record?',
  },
  {
    id: 'team-002',
    category: 'team seasons',
    question: 'What was the 1995-96 Chicago Bulls regular season record?',
  },
  {
    id: 'team-003',
    category: 'team seasons',
    question: 'Which NBA team had the best SRS in the 2015-16 season?',
  },
  {
    id: 'team-004',
    category: 'team seasons',
    question: 'Which NBA team had the best defensive rating in the 2023-24 season?',
  },
  {
    id: 'team-005',
    category: 'team seasons',
    question: 'Which NBA team had the best offensive rating in the 2022-23 season?',
  },
  {
    id: 'team-006',
    category: 'team seasons',
    question: 'What was the Boston Celtics record and SRS in the 2023-24 season?',
  },
  {
    id: 'team-007',
    category: 'team seasons',
    question: 'What was the Denver Nuggets record and SRS in the 2022-23 season?',
  },
  {
    id: 'team-008',
    category: 'team seasons',
    question: 'Which teams played at the fastest pace in the 2023-24 season?',
  },
  {
    id: 'team-009',
    category: 'team seasons',
    question: 'Which teams allowed the fewest points per game in the 2021-22 season?',
  },
  {
    id: 'team-010',
    category: 'team seasons',
    question: 'Which teams scored the most points per game in the 2020-21 season?',
  },
  {
    id: 'games-001',
    category: 'games',
    question: 'What was the final score of 2016 NBA Finals Game 7?',
  },
  {
    id: 'games-002',
    category: 'games',
    question: 'Who scored the most points in 2016 NBA Finals Game 7?',
  },
  {
    id: 'games-003',
    category: 'games',
    question: 'What was LeBron James stat line in game_id 0041500407?',
  },
  {
    id: 'games-004',
    category: 'games',
    question: 'What was Stephen Curry stat line in game_id 0041500407?',
  },
  {
    id: 'games-005',
    category: 'games',
    question:
      'Which games had the highest combined score in regular season history in the database?',
  },
  {
    id: 'games-006',
    category: 'games',
    question: 'Which players scored at least 70 points in a regular season game?',
  },
  {
    id: 'games-007',
    category: 'games',
    question: 'Which players had at least 25 assists in a regular season game?',
  },
  {
    id: 'games-008',
    category: 'games',
    question: 'Which players had at least 25 rebounds in a regular season game since 2000?',
  },
  {
    id: 'games-009',
    category: 'games',
    question: 'Which players had at least 10 blocks in a regular season game since 2000?',
  },
  {
    id: 'games-010',
    category: 'games',
    question: 'Which players had at least 10 steals in a regular season game since 2000?',
  },
  {
    id: 'shots-001',
    category: 'shot charts',
    question:
      'How many three pointers did Stephen Curry make in the 2015-16 regular season shot chart data?',
    expectedTools: ['query_nba_db'],
    expectNoSqlError: true,
  },
  {
    id: 'shots-002',
    category: 'shot charts',
    question:
      'How many three pointers did Klay Thompson make in the 2015-16 regular season shot chart data?',
  },
  {
    id: 'shots-003',
    category: 'shot charts',
    question: 'Which players made the most corner threes in the 2023-24 shot chart data?',
  },
  {
    id: 'shots-004',
    category: 'shot charts',
    question: 'Which players attempted the most shots at the rim in the 2023-24 shot chart data?',
  },
  {
    id: 'shots-005',
    category: 'shot charts',
    question: 'What was LeBron James shot distribution by zone in the 2023-24 shot chart data?',
  },
  {
    id: 'shots-006',
    category: 'shot charts',
    question: 'What was Nikola Jokic shot distribution by zone in the 2023-24 shot chart data?',
  },
  {
    id: 'shots-007',
    category: 'shot charts',
    question: 'Which teams allowed the most made threes in the 2023-24 shot chart data?',
  },
  {
    id: 'shots-008',
    category: 'shot charts',
    question: 'Which players had the most mid-range makes in the 2022-23 shot chart data?',
  },
  {
    id: 'pbp-001',
    category: 'play by play',
    question: 'How many made shots are in the play-by-play data for game_id 0041500407?',
  },
  {
    id: 'pbp-002',
    category: 'play by play',
    question: 'How many turnovers are in the play-by-play data for game_id 0041500407?',
  },
  {
    id: 'identity-001',
    category: 'identity',
    question: 'What Basketball-Reference ID is linked to LeBron James?',
    expectedTools: ['query_nba_db'],
    expectNoSqlError: true,
  },
  {
    id: 'identity-002',
    category: 'identity',
    question: 'What NBA API person_id is linked to Michael Jordan?',
  },
  {
    id: 'identity-003',
    category: 'identity',
    question: 'Which Basketball-Reference players are unresolved in the identity bridge?',
  },
  {
    id: 'identity-004',
    category: 'identity',
    question: 'Which Basketball-Reference players are ambiguous in the identity bridge?',
  },
  {
    id: 'identity-005',
    category: 'identity',
    question: 'What current team row should I use for the Oklahoma City Thunder?',
  },
  {
    id: 'draft-001',
    category: 'draft',
    question:
      'Who was selected first overall in the 2003 NBA draft according to Basketball-Reference?',
  },
  {
    id: 'draft-002',
    category: 'draft',
    question:
      'Who was selected first overall in the 1984 NBA draft according to Basketball-Reference?',
  },
  {
    id: 'draft-003',
    category: 'draft',
    question: 'Compare LeBron James draft pick between BRef and NBA API tables.',
  },
  {
    id: 'draft-004',
    category: 'draft',
    question: 'Which 1996 draft picks became Hall of Fame players in the database?',
  },
  {
    id: 'draft-005',
    category: 'draft',
    question: 'Which teams had the first five picks in the 2023 NBA draft?',
  },
  {
    id: 'bref-001',
    category: 'basketball reference',
    question: 'Using Basketball-Reference season totals, what were Luka Doncic totals in 2023-24?',
  },
  {
    id: 'bref-002',
    category: 'basketball reference',
    question:
      'Using Basketball-Reference advanced stats, what was Giannis Antetokounmpo PER in 2018-19?',
  },
  {
    id: 'bref-003',
    category: 'basketball reference',
    question:
      'Using Basketball-Reference team summaries, what was the 2023-24 Celtics net rating context?',
  },
  {
    id: 'bref-004',
    category: 'basketball reference',
    question:
      'Using Basketball-Reference player shooting, what share of Stephen Curry 2015-16 shots were threes?',
  },
  {
    id: 'bref-005',
    category: 'basketball reference',
    question:
      'Using raw Basketball-Reference data, does LeBron James have a player career info row?',
  },
  {
    id: 'api-001',
    category: 'api schema',
    question: 'Using the api schema, show LeBron James recent game log rows.',
  },
  {
    id: 'api-002',
    category: 'api schema',
    question: 'Using the api schema, show a Stephen Curry shot chart summary.',
  },
  {
    id: 'api-003',
    category: 'api schema',
    question: 'Using the api schema, show current standings if available.',
  },
  {
    id: 'api-004',
    category: 'api schema',
    question: 'Using the api schema, show franchise leaders for the Lakers if available.',
  },
  {
    id: 'api-005',
    category: 'api schema',
    question: 'Using nbadb, show recent team game log rows for the Boston Celtics.',
  },
  {
    id: 'quality-001',
    category: 'data quality',
    question: 'What data quality issues are recorded in audit.dq_results?',
  },
  {
    id: 'quality-002',
    category: 'data quality',
    question: 'What row counts are recorded by source in the audit schema?',
  },
  {
    id: 'quality-003',
    category: 'data quality',
    question: 'Which tables have key candidates in the audit schema?',
  },
  {
    id: 'quality-004',
    category: 'data quality',
    question: 'What does the audit schema say about player identity bridge quality?',
  },
  {
    id: 'quality-005',
    category: 'data quality',
    question: 'Which schemas and tables are available for NBA questions?',
    expectedTools: ['list_nba_tables'],
    expectNoSqlError: true,
  },
  {
    id: 'cross-001',
    category: 'cross schema',
    question: 'Cross-check Nikola Jokic MVP awards between main and unified_star.',
  },
  {
    id: 'cross-002',
    category: 'cross schema',
    question: 'Cross-check 2016 Finals Game 7 score between main and unified_star.',
  },
  {
    id: 'cross-003',
    category: 'cross schema',
    question: 'Cross-check LeBron James draft pick between BRef and NBA API tables.',
  },
  {
    id: 'cross-004',
    category: 'cross schema',
    question:
      'Cross-check Stephen Curry 2015-16 made threes between BRef totals and shot chart data.',
  },
  {
    id: 'cross-005',
    category: 'cross schema',
    question: 'Which source should be used for exact Basketball-Reference career totals, and why?',
  },
];
