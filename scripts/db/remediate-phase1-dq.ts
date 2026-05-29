/**
 * Phase 1 data-quality remediation for the `nbadb` star tier.
 *
 * This is intentionally a curated-layer remediation because the checked-in repo
 * does not contain the full warehouse build pipeline, and the available staging
 * tables already contain the defects this script corrects. The script is
 * repeatable: it captures the violating key sets into audit tables first, then
 * applies narrowly scoped, idempotent updates/inserts, and finishes with
 * CHECKPOINT.
 *
 * Usage:
 *   bun run scripts/db/remediate-phase1-dq.ts --dry-run
 *   bun run scripts/db/remediate-phase1-dq.ts --apply
 */
import { DuckDBInstance } from '@duckdb/node-api';

const DB_PATH = process.env['NBA_DUCKDB_PATH'] ?? './data/nba.duckdb';

const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const dryRun = args.has('--dry-run') || !apply;
const runId = new Date().toISOString().replace('T', ' ').replace('Z', '');

const db = await DuckDBInstance.fromCache(DB_PATH);
const conn = await db.connect();

async function rows(sql: string): Promise<Array<Record<string, unknown>>> {
  return (await conn.runAndReadAll(sql)).getRowObjectsJson() as Array<Record<string, unknown>>;
}

async function scalar(sql: string): Promise<number> {
  const [row] = await rows(sql);
  return Number(row?.['n'] ?? 0);
}

async function run(sql: string): Promise<void> {
  if (dryRun) {
    console.log(`\n-- DRY RUN SQL --\n${sql.trim()}\n`);
    return;
  }
  await conn.run(sql);
}

async function reportCount(label: string, sql: string): Promise<void> {
  const n = await scalar(sql);
  console.log(`${label.padEnd(48)} ${n}`);
}

const knownTeams = [
  {
    teamId: 0,
    abbreviation: 'TBD',
    fullName: 'Unknown Special Event Team',
    city: 'Unknown',
    state: 'Special Event',
  },
  {
    teamId: 15016,
    abbreviation: 'MEL',
    fullName: 'Melbourne United',
    city: 'Melbourne',
    state: 'Australia',
  },
  {
    teamId: 15018,
    abbreviation: 'GUA',
    fullName: 'Guangzhou Long-Lions',
    city: 'Guangzhou',
    state: 'China',
  },
  {
    teamId: 15020,
    abbreviation: 'NZB',
    fullName: 'New Zealand Breakers',
    city: 'New Zealand',
    state: 'International',
  },
  {
    teamId: 15025,
    abbreviation: 'ADL',
    fullName: 'Adelaide 36ers',
    city: 'Adelaide',
    state: 'Australia',
  },
  {
    teamId: 50013,
    abbreviation: 'PRE',
    fullName: 'Preseason International Opponent 50013',
    city: 'International',
    state: 'International',
  },
  {
    teamId: 50014,
    abbreviation: 'PRE',
    fullName: 'Preseason International Opponent 50014',
    city: 'International',
    state: 'International',
  },
  {
    teamId: 1610616833,
    abbreviation: 'EST',
    fullName: 'Eastern Conference All-Stars',
    city: 'East NBA All Stars',
    state: 'Special Event',
  },
  {
    teamId: 1610616834,
    abbreviation: 'WST',
    fullName: 'Western Conference All-Stars',
    city: 'West NBA All Stars',
    state: 'Special Event',
  },
  {
    teamId: 1610616851,
    abbreviation: 'AS1',
    fullName: 'All-Star Special Event Team 1',
    city: 'NBA All-Star',
    state: 'Special Event',
  },
  {
    teamId: 1610616852,
    abbreviation: 'AS2',
    fullName: 'All-Star Special Event Team 2',
    city: 'NBA All-Star',
    state: 'Special Event',
  },
  {
    teamId: 1610616853,
    abbreviation: 'AS3',
    fullName: 'All-Star Special Event Team 3',
    city: 'NBA All-Star',
    state: 'Special Event',
  },
  {
    teamId: 1610616854,
    abbreviation: 'AS4',
    fullName: 'All-Star Special Event Team 4',
    city: 'NBA All-Star',
    state: 'Special Event',
  },
  {
    teamId: 1610616859,
    abbreviation: 'RS1',
    fullName: 'Rising Stars Special Event Team 1',
    city: 'NBA Rising Stars',
    state: 'Special Event',
  },
  {
    teamId: 1610616860,
    abbreviation: 'RS2',
    fullName: 'Rising Stars Special Event Team 2',
    city: 'NBA Rising Stars',
    state: 'Special Event',
  },
  {
    teamId: 1610616861,
    abbreviation: 'RS3',
    fullName: 'Rising Stars Special Event Team 3',
    city: 'NBA Rising Stars',
    state: 'Special Event',
  },
  {
    teamId: 1610616862,
    abbreviation: 'RS4',
    fullName: 'Rising Stars Special Event Team 4',
    city: 'NBA Rising Stars',
    state: 'Special Event',
  },
  {
    teamId: 1610616863,
    abbreviation: 'RS5',
    fullName: 'Rising Stars Special Event Team 5',
    city: 'NBA Rising Stars',
    state: 'Special Event',
  },
  {
    teamId: 1610616864,
    abbreviation: 'RS6',
    fullName: 'Rising Stars Special Event Team 6',
    city: 'NBA Rising Stars',
    state: 'Special Event',
  },
  {
    teamId: 1610616865,
    abbreviation: 'RS7',
    fullName: 'Rising Stars Special Event Team 7',
    city: 'NBA Rising Stars',
    state: 'Special Event',
  },
] as const;

function values(rowsToInsert: ReadonlyArray<Record<string, string | number | null>>): string {
  return rowsToInsert
    .map((row) => {
      const vals = Object.values(row).map((value) => {
        if (value === null) return 'NULL';
        if (typeof value === 'number') return String(value);
        return `'${value.replaceAll("'", "''")}'`;
      });
      return `(${vals.join(', ')})`;
    })
    .join(',\n');
}

const teamValues = values(
  knownTeams.map((team) => ({
    team_id: team.teamId,
    abbreviation: team.abbreviation,
    full_name: team.fullName,
    city: team.city,
    state: team.state,
    arena: 'Special Event',
    year_founded: null,
    conference: 'Special',
    division: 'Special Event',
  })),
);

console.log(`${dryRun ? '[DRY RUN]' : '[APPLY]'} Phase 1 DQ remediation`);
console.log(`DB: ${DB_PATH}`);
console.log(`run_id: ${runId}\n`);

console.log('Before:');
await reportCount(
  'pgt made > attempts',
  `SELECT count(*) AS n FROM nbadb.fact_player_game_traditional
   WHERE fgm > fga OR fg3m > fg3a OR ftm > fta`,
);
await reportCount(
  'pgt 3pt not subset',
  `SELECT count(*) AS n FROM nbadb.fact_player_game_traditional
   WHERE fg3m > fgm OR fg3a > fga`,
);
await reportCount(
  'pgt pct outside [0,1]',
  `SELECT count(*) AS n FROM nbadb.fact_player_game_traditional
   WHERE fg_pct < 0 OR fg_pct > 1 OR fg3_pct < 0 OR fg3_pct > 1 OR ft_pct < 0 OR ft_pct > 1`,
);
await reportCount(
  'pgt rebound component mismatch',
  `SELECT count(*) AS n FROM nbadb.fact_player_game_traditional
   WHERE oreb IS NOT NULL AND dreb IS NOT NULL AND reb IS NOT NULL AND oreb + dreb <> reb`,
);
await reportCount(
  'game result components exceed total',
  `SELECT count(*) AS n FROM nbadb.fact_game_result
   WHERE coalesce(pts_qtr1_home,0)+coalesce(pts_qtr2_home,0)+coalesce(pts_qtr3_home,0)+coalesce(pts_qtr4_home,0)+coalesce(pts_ot1_home,0)+coalesce(pts_ot2_home,0) > pts_home
      OR coalesce(pts_qtr1_away,0)+coalesce(pts_qtr2_away,0)+coalesce(pts_qtr3_away,0)+coalesce(pts_qtr4_away,0)+coalesce(pts_ot1_away,0)+coalesce(pts_ot2_away,0) > pts_away`,
);
await reportCount(
  'team game quarters exceed total',
  `SELECT count(*) AS n FROM nbadb.fact_team_game
   WHERE pts_qtr1 + pts_qtr2 + pts_qtr3 + pts_qtr4 > pts`,
);
await reportCount(
  'pgt orphan players',
  `SELECT count(*) AS n FROM (SELECT DISTINCT player_id FROM nbadb.fact_player_game_traditional p
   WHERE player_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM nbadb.dim_player dp WHERE dp.player_id = p.player_id))`,
);
await reportCount(
  'pgt orphan teams',
  `SELECT count(*) AS n FROM (SELECT DISTINCT team_id FROM nbadb.fact_player_game_traditional p
   WHERE team_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM nbadb.dim_team dt WHERE dt.team_id = p.team_id))`,
);
await reportCount(
  'game result orphan teams',
  `SELECT count(*) AS n FROM (
     SELECT home_team_id AS team_id FROM nbadb.fact_game_result gr
      WHERE home_team_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM nbadb.dim_team dt WHERE dt.team_id = gr.home_team_id)
     UNION
     SELECT visitor_team_id FROM nbadb.fact_game_result gr
      WHERE visitor_team_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM nbadb.dim_team dt WHERE dt.team_id = gr.visitor_team_id)
   )`,
);

await run(`
  CREATE SCHEMA IF NOT EXISTS audit;

  CREATE TABLE IF NOT EXISTS audit.phase1_dq_violation_keys (
    run_id TIMESTAMP,
    check_name VARCHAR,
    table_name VARCHAR,
    game_id VARCHAR,
    player_id BIGINT,
    team_id BIGINT,
    side VARCHAR,
    reason VARCHAR,
    captured_at TIMESTAMP
  );

  DELETE FROM audit.phase1_dq_violation_keys WHERE run_id = TIMESTAMP '${runId}';

  INSERT INTO audit.phase1_dq_violation_keys
  SELECT TIMESTAMP '${runId}', 'pgt_fg_consistency', 'nbadb.fact_player_game_traditional',
         game_id, player_id, team_id, NULL,
         concat_ws('; ',
           CASE WHEN fgm > fga THEN 'fgm>fga' END,
           CASE WHEN fg3m > fg3a THEN 'fg3m>fg3a' END,
           CASE WHEN ftm > fta THEN 'ftm>fta' END),
         now()
  FROM nbadb.fact_player_game_traditional
  WHERE fgm > fga OR fg3m > fg3a OR ftm > fta;

  INSERT INTO audit.phase1_dq_violation_keys
  SELECT TIMESTAMP '${runId}', 'pgt_3p_subset', 'nbadb.fact_player_game_traditional',
         game_id, player_id, team_id, NULL,
         concat_ws('; ',
           CASE WHEN fg3m > fgm THEN 'fg3m>fgm' END,
           CASE WHEN fg3a > fga THEN 'fg3a>fga' END),
         now()
  FROM nbadb.fact_player_game_traditional
  WHERE fg3m > fgm OR fg3a > fga;

  INSERT INTO audit.phase1_dq_violation_keys
  SELECT TIMESTAMP '${runId}', 'pgt_pct_range', 'nbadb.fact_player_game_traditional',
         game_id, player_id, team_id, NULL, 'pct outside [0,1]', now()
  FROM nbadb.fact_player_game_traditional
  WHERE fg_pct < 0 OR fg_pct > 1 OR fg3_pct < 0 OR fg3_pct > 1 OR ft_pct < 0 OR ft_pct > 1;

  INSERT INTO audit.phase1_dq_violation_keys
  SELECT TIMESTAMP '${runId}', 'pgt_reb_consistency', 'nbadb.fact_player_game_traditional',
         game_id, player_id, team_id, NULL, 'oreb+dreb<>reb', now()
  FROM nbadb.fact_player_game_traditional
  WHERE oreb IS NOT NULL AND dreb IS NOT NULL AND reb IS NOT NULL AND oreb + dreb <> reb;

  INSERT INTO audit.phase1_dq_violation_keys
  SELECT TIMESTAMP '${runId}', 'team_game_quarter_exceeds_total', 'nbadb.fact_team_game',
         game_id, NULL, team_id, NULL, 'q1-q4 sum > pts', now()
  FROM nbadb.fact_team_game
  WHERE pts_qtr1 + pts_qtr2 + pts_qtr3 + pts_qtr4 > pts;

  INSERT INTO audit.phase1_dq_violation_keys
  SELECT TIMESTAMP '${runId}', 'game_result_components_exceed_total', 'nbadb.fact_game_result',
         game_id, NULL, home_team_id, 'home', 'home components > pts_home', now()
  FROM nbadb.fact_game_result
  WHERE coalesce(pts_qtr1_home,0)+coalesce(pts_qtr2_home,0)+coalesce(pts_qtr3_home,0)+coalesce(pts_qtr4_home,0)+coalesce(pts_ot1_home,0)+coalesce(pts_ot2_home,0) > pts_home
  UNION ALL
  SELECT TIMESTAMP '${runId}', 'game_result_components_exceed_total', 'nbadb.fact_game_result',
         game_id, NULL, visitor_team_id, 'away', 'away components > pts_away', now()
  FROM nbadb.fact_game_result
  WHERE coalesce(pts_qtr1_away,0)+coalesce(pts_qtr2_away,0)+coalesce(pts_qtr3_away,0)+coalesce(pts_qtr4_away,0)+coalesce(pts_ot1_away,0)+coalesce(pts_ot2_away,0) > pts_away;
`);

// Shooting attempts and percentages: impossible denominator/total values are
// unknown, not zero. Preserve makes/points and null the impossible component.
await run(`
  UPDATE nbadb.fact_player_game_traditional
  SET
    fga = CASE WHEN fgm > fga OR fg3a > fga THEN NULL ELSE fga END,
    fg3a = CASE WHEN fg3m > fg3a THEN NULL ELSE fg3a END,
    fta = CASE WHEN ftm > fta THEN NULL ELSE fta END,
    fgm = CASE WHEN fg3m > fgm THEN NULL ELSE fgm END;

  UPDATE nbadb.fact_player_game_traditional
  SET
    fg_pct = CASE
      WHEN fga IS NULL OR fga = 0 OR fgm IS NULL THEN NULL
      ELSE round(fgm * 1.0 / fga, 3)
    END,
    fg3_pct = CASE
      WHEN fg3a IS NULL OR fg3a = 0 OR fg3m IS NULL THEN NULL
      ELSE round(fg3m * 1.0 / fg3a, 3)
    END,
    ft_pct = CASE
      WHEN fta IS NULL OR fta = 0 OR ftm IS NULL THEN NULL
      ELSE round(ftm * 1.0 / fta, 3)
    END
  WHERE fga IS NULL OR fga = 0 OR fgm IS NULL
     OR fg3a IS NULL OR fg3a = 0 OR fg3m IS NULL
     OR fta IS NULL OR fta = 0 OR ftm IS NULL
     OR fg_pct < 0 OR fg_pct > 1 OR fg3_pct < 0 OR fg3_pct > 1 OR ft_pct < 0 OR ft_pct > 1;
`);

// Rebound components: when component splits contradict the total, keep the
// total rebound count and mark the split components unknown.
await run(`
  UPDATE nbadb.fact_player_game_traditional
  SET oreb = NULL, dreb = NULL
  WHERE oreb IS NOT NULL AND dreb IS NOT NULL AND reb IS NOT NULL AND oreb + dreb <> reb;
`);

// The systemic fact_game_result defect is home/away period components assigned
// to the opposite final-score side. Swap only exact swapped-sum rows.
await run(`
  UPDATE nbadb.fact_game_result
  SET
    pts_qtr1_home = pts_qtr1_away,
    pts_qtr2_home = pts_qtr2_away,
    pts_qtr3_home = pts_qtr3_away,
    pts_qtr4_home = pts_qtr4_away,
    pts_ot1_home = pts_ot1_away,
    pts_ot2_home = pts_ot2_away,
    pts_qtr1_away = pts_qtr1_home,
    pts_qtr2_away = pts_qtr2_home,
    pts_qtr3_away = pts_qtr3_home,
    pts_qtr4_away = pts_qtr4_home,
    pts_ot1_away = pts_ot1_home,
    pts_ot2_away = pts_ot2_home
  WHERE coalesce(pts_qtr1_home,0)+coalesce(pts_qtr2_home,0)+coalesce(pts_qtr3_home,0)+coalesce(pts_qtr4_home,0)+coalesce(pts_ot1_home,0)+coalesce(pts_ot2_home,0) = pts_away
    AND coalesce(pts_qtr1_away,0)+coalesce(pts_qtr2_away,0)+coalesce(pts_qtr3_away,0)+coalesce(pts_qtr4_away,0)+coalesce(pts_ot1_away,0)+coalesce(pts_ot2_away,0) = pts_home
    AND (pts_home <> pts_away OR home_team_id <> visitor_team_id);
`);

// Remaining line-score rows are small source anomalies. Keep finals
// authoritative and reduce the last known period by the excess.
await run(`
  UPDATE nbadb.fact_team_game
  SET pts_qtr4 = pts - coalesce(pts_qtr1,0) - coalesce(pts_qtr2,0) - coalesce(pts_qtr3,0)
  WHERE pts_qtr1 + pts_qtr2 + pts_qtr3 + pts_qtr4 > pts
    AND pts - coalesce(pts_qtr1,0) - coalesce(pts_qtr2,0) - coalesce(pts_qtr3,0) >= 0;

  UPDATE nbadb.fact_game_result
  SET pts_qtr4_home = pts_home - coalesce(pts_qtr1_home,0) - coalesce(pts_qtr2_home,0) - coalesce(pts_qtr3_home,0)
  WHERE coalesce(pts_qtr1_home,0)+coalesce(pts_qtr2_home,0)+coalesce(pts_qtr3_home,0)+coalesce(pts_qtr4_home,0)+coalesce(pts_ot1_home,0)+coalesce(pts_ot2_home,0) > pts_home
    AND coalesce(pts_ot1_home,0) = 0
    AND coalesce(pts_ot2_home,0) = 0
    AND pts_home - coalesce(pts_qtr1_home,0) - coalesce(pts_qtr2_home,0) - coalesce(pts_qtr3_home,0) >= 0;

  UPDATE nbadb.fact_game_result
  SET pts_qtr4_away = pts_away - coalesce(pts_qtr1_away,0) - coalesce(pts_qtr2_away,0) - coalesce(pts_qtr3_away,0)
  WHERE coalesce(pts_qtr1_away,0)+coalesce(pts_qtr2_away,0)+coalesce(pts_qtr3_away,0)+coalesce(pts_qtr4_away,0)+coalesce(pts_ot1_away,0)+coalesce(pts_ot2_away,0) > pts_away
    AND coalesce(pts_ot1_away,0) = 0
    AND coalesce(pts_ot2_away,0) = 0
    AND pts_away - coalesce(pts_qtr1_away,0) - coalesce(pts_qtr2_away,0) - coalesce(pts_qtr3_away,0) >= 0;

  UPDATE nbadb.fact_game_result
  SET
    pts_qtr1_home = NULL,
    pts_qtr2_home = NULL,
    pts_qtr3_home = NULL,
    pts_qtr4_home = NULL,
    pts_ot1_home = NULL,
    pts_ot2_home = NULL
  WHERE coalesce(pts_qtr1_home,0)+coalesce(pts_qtr2_home,0)+coalesce(pts_qtr3_home,0)+coalesce(pts_qtr4_home,0)+coalesce(pts_ot1_home,0)+coalesce(pts_ot2_home,0) > pts_home;

  UPDATE nbadb.fact_game_result
  SET
    pts_qtr1_away = NULL,
    pts_qtr2_away = NULL,
    pts_qtr3_away = NULL,
    pts_qtr4_away = NULL,
    pts_ot1_away = NULL,
    pts_ot2_away = NULL
  WHERE coalesce(pts_qtr1_away,0)+coalesce(pts_qtr2_away,0)+coalesce(pts_qtr3_away,0)+coalesce(pts_qtr4_away,0)+coalesce(pts_ot1_away,0)+coalesce(pts_ot2_away,0) > pts_away;
`);

// Historical All-Star game ids were parsed as 20xx for old yy prefixes.
await run(`
  UPDATE nbadb.fact_player_game_traditional
  SET season_year =
    '19' || substr(game_id, 4, 2) || '-' ||
    lpad(CAST(((CAST(substr(game_id, 4, 2) AS INTEGER) + 1) % 100) AS VARCHAR), 2, '0')
  WHERE game_id LIKE '003%'
    AND CAST(substr(game_id, 4, 2) AS INTEGER) >= 46
    AND CAST(substr(season_year, 1, 4) AS INTEGER) > EXTRACT(year FROM current_date) + 1;

  UPDATE nbadb.dim_game
  SET season_year =
    '19' || substr(game_id, 4, 2) || '-' ||
    lpad(CAST(((CAST(substr(game_id, 4, 2) AS INTEGER) + 1) % 100) AS VARCHAR), 2, '0')
  WHERE game_id LIKE '003%'
    AND CAST(substr(game_id, 4, 2) AS INTEGER) >= 46
    AND CAST(substr(season_year, 1, 4) AS INTEGER) > EXTRACT(year FROM current_date) + 1;
`);

// Add explicit dimension members for special-event and international opponent
// teams referenced by facts. The canonical franchise dimension still contains
// historical aliases; v_dim_team_current exposes one row per team_id for joins.
await run(`
  INSERT INTO nbadb.dim_team
    (team_id, abbreviation, full_name, city, state, arena, year_founded, conference, division)
  SELECT team_id, abbreviation, full_name, city, state, arena, year_founded, conference, division
  FROM (VALUES
    ${teamValues}
  ) AS v(team_id, abbreviation, full_name, city, state, arena, year_founded, conference, division)
  WHERE NOT EXISTS (SELECT 1 FROM nbadb.dim_team t WHERE t.team_id = v.team_id);

  CREATE OR REPLACE VIEW nbadb.v_dim_team_current AS
  SELECT * EXCLUDE (rn)
  FROM (
    SELECT t.*,
           row_number() OVER (
             PARTITION BY team_id
             ORDER BY
               CASE
                 WHEN state = 'Special Event' THEN 0
                 WHEN abbreviation IN ('ATL','BKN','CHA','DET','GSW','HOU','LAC','LAL','MEM','NOP','OKC','SAC','UTA','WAS') THEN 0
                 ELSE 1
               END,
               year_founded DESC NULLS LAST,
               abbreviation DESC
           ) AS rn
    FROM nbadb.dim_team t
  )
  WHERE rn = 1;
`);

// Add placeholder identity rows for otherwise valid special-event player ids.
await run(`
  INSERT INTO nbadb.dim_player
    (player_sk, player_id, full_name, first_name, last_name, is_active, team_id, position,
     jersey_number, height, weight, birth_date, country, college_id, draft_year, draft_round,
     draft_number, from_year, to_year, valid_from, valid_to, is_current)
  WITH missing AS (
    SELECT DISTINCT p.player_id
    FROM nbadb.fact_player_game_traditional p
    WHERE p.player_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM nbadb.dim_player dp WHERE dp.player_id = p.player_id)
  ),
  numbered AS (
    SELECT player_id, row_number() OVER (ORDER BY player_id) AS rn FROM missing
  ),
  base AS (
    SELECT coalesce(max(player_sk), 0) AS max_sk FROM nbadb.dim_player
  )
  SELECT base.max_sk + numbered.rn AS player_sk,
         player_id,
         'Unknown Player ' || player_id AS full_name,
         'Unknown' AS first_name,
         CAST(player_id AS VARCHAR) AS last_name,
         false AS is_active,
         NULL AS team_id,
         NULL AS position,
         NULL AS jersey_number,
         NULL AS height,
         NULL AS weight,
         NULL AS birth_date,
         NULL AS country,
         NULL AS college_id,
         NULL AS draft_year,
         NULL AS draft_round,
         NULL AS draft_number,
         NULL AS from_year,
         NULL AS to_year,
         '1900-01-01' AS valid_from,
         NULL AS valid_to,
         true AS is_current
  FROM numbered
  CROSS JOIN base;
`);

if (!dryRun) {
  await conn.run('CHECKPOINT');
}

console.log('\nAfter:');
await reportCount(
  'pgt made > attempts',
  `SELECT count(*) AS n FROM nbadb.fact_player_game_traditional
   WHERE fgm > fga OR fg3m > fg3a OR ftm > fta`,
);
await reportCount(
  'pgt 3pt not subset',
  `SELECT count(*) AS n FROM nbadb.fact_player_game_traditional
   WHERE fg3m > fgm OR fg3a > fga`,
);
await reportCount(
  'pgt pct outside [0,1]',
  `SELECT count(*) AS n FROM nbadb.fact_player_game_traditional
   WHERE fg_pct < 0 OR fg_pct > 1 OR fg3_pct < 0 OR fg3_pct > 1 OR ft_pct < 0 OR ft_pct > 1`,
);
await reportCount(
  'pgt rebound component mismatch',
  `SELECT count(*) AS n FROM nbadb.fact_player_game_traditional
   WHERE oreb IS NOT NULL AND dreb IS NOT NULL AND reb IS NOT NULL AND oreb + dreb <> reb`,
);
await reportCount(
  'game result components exceed total',
  `SELECT count(*) AS n FROM nbadb.fact_game_result
   WHERE coalesce(pts_qtr1_home,0)+coalesce(pts_qtr2_home,0)+coalesce(pts_qtr3_home,0)+coalesce(pts_qtr4_home,0)+coalesce(pts_ot1_home,0)+coalesce(pts_ot2_home,0) > pts_home
      OR coalesce(pts_qtr1_away,0)+coalesce(pts_qtr2_away,0)+coalesce(pts_qtr3_away,0)+coalesce(pts_qtr4_away,0)+coalesce(pts_ot1_away,0)+coalesce(pts_ot2_away,0) > pts_away`,
);
await reportCount(
  'team game quarters exceed total',
  `SELECT count(*) AS n FROM nbadb.fact_team_game
   WHERE pts_qtr1 + pts_qtr2 + pts_qtr3 + pts_qtr4 > pts`,
);
await reportCount(
  'pgt orphan players',
  `SELECT count(*) AS n FROM (SELECT DISTINCT player_id FROM nbadb.fact_player_game_traditional p
   WHERE player_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM nbadb.dim_player dp WHERE dp.player_id = p.player_id))`,
);
await reportCount(
  'pgt orphan teams',
  `SELECT count(*) AS n FROM (SELECT DISTINCT team_id FROM nbadb.fact_player_game_traditional p
   WHERE team_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM nbadb.dim_team dt WHERE dt.team_id = p.team_id))`,
);
await reportCount(
  'game result orphan teams',
  `SELECT count(*) AS n FROM (
     SELECT home_team_id AS team_id FROM nbadb.fact_game_result gr
      WHERE home_team_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM nbadb.dim_team dt WHERE dt.team_id = gr.home_team_id)
     UNION
     SELECT visitor_team_id FROM nbadb.fact_game_result gr
      WHERE visitor_team_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM nbadb.dim_team dt WHERE dt.team_id = gr.visitor_team_id)
   )`,
);

console.log(
  dryRun ? '\nDry run complete. Use --apply to write changes.' : '\nRemediation complete.',
);
conn.closeSync();
