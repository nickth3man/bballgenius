/**
 * Builds a read-only canonical cross-source merge view for player-season 3-point
 * makes (3PM), unifying Basketball-Reference and NBA Stats API totals through the
 * canonical player identity bridge.
 *
 * Sources (season-totals grain, NBA only, regular season):
 *   - main.fact_bref_player_season_totals  (bref_player_id, season, x3p)   [Basketball-Reference]
 *   - nbadb.fact_player_career             (player_id, season_id, fg3m)    [NBA Stats API]
 * Identity bridge:
 *   - main.bridge_player_source_id  (basketball_reference source_player_id -> person_id)
 *
 * Grain handling: both sources emit one row per team for multi-team seasons plus a
 * combined "<N>TM" row. We keep the combined row when present (else the single team
 * row), yielding exactly one row per (player, season). Bridge rows are filtered to
 * is_unresolved=false AND is_ambiguous=false. Seasons share the BBR end-year
 * convention (e.g. 2004 = 2003-04), confirmed by exact 3PM agreement.
 *
 * This script is read-only by default (validation counts only). Pass --apply to
 * persist the view via CREATE OR REPLACE VIEW (catalog-only DDL; reversible with
 * DROP VIEW). It never mutates base-table rows.
 *
 *   bun run scripts/db/build-player-season-3p-unified-view.ts            # validate (read-only)
 *   bun run scripts/db/build-player-season-3p-unified-view.ts --apply    # persist the view
 */

import { DuckDBInstance } from '@duckdb/node-api';

const DB_PATH = './data/nba.duckdb';
const VIEW_NAME = 'api.v_player_season_3p_unified';

const args = new Set(process.argv.slice(2));

const SELECT_SQL = `
WITH bref AS (
  SELECT bref_player_id, season, player_name, x3p AS bref_fg3m, x3pa AS bref_fg3a, g AS bref_g
  FROM (
    SELECT *, row_number() OVER (
      PARTITION BY bref_player_id, season
      ORDER BY CASE WHEN team ~ '^[0-9]+TM$' THEN 0 ELSE 1 END, g DESC
    ) AS rn
    FROM main.fact_bref_player_season_totals
  ) WHERE rn = 1
),
nba AS (
  SELECT player_id, CAST(season_id AS INTEGER) AS season, fg3m AS nba_fg3m, fg3a AS nba_fg3a, gp AS nba_gp
  FROM (
    SELECT *, row_number() OVER (
      PARTITION BY player_id, season_id
      ORDER BY CASE WHEN team_abbreviation ~ '^[0-9]+TM$' THEN 0 ELSE 1 END, gp DESC
    ) AS rn
    FROM nbadb.fact_player_career
    WHERE career_type = 'Regular Season' AND league_id = 'NBA'
  ) WHERE rn = 1
),
bridge AS (
  SELECT source_player_id, person_id, match_confidence
  FROM main.bridge_player_source_id
  WHERE source_system = 'basketball_reference'
    AND is_unresolved = false
    AND is_ambiguous = false
),
bref_keyed AS (
  SELECT bref.*, bridge.person_id, bridge.match_confidence
  FROM bref
  LEFT JOIN bridge ON bridge.source_player_id = bref.bref_player_id
)
SELECT
  COALESCE(bk.person_id, nba.player_id) AS person_id,
  bk.bref_player_id,
  bk.player_name,
  COALESCE(bk.season, nba.season) AS season,
  bk.bref_fg3m,
  nba.nba_fg3m,
  bk.bref_fg3m - nba.nba_fg3m AS fg3m_diff,
  bk.bref_fg3a,
  nba.nba_fg3a,
  bk.bref_g,
  nba.nba_gp,
  bk.match_confidence,
  CASE
    WHEN bk.bref_fg3m IS NOT NULL AND nba.nba_fg3m IS NOT NULL
      THEN CASE WHEN bk.bref_fg3m = nba.nba_fg3m THEN 'agree' ELSE 'disagree' END
    WHEN bk.bref_fg3m IS NOT NULL THEN 'bref_only'
    WHEN nba.nba_fg3m IS NOT NULL THEN 'nba_only'
    ELSE 'no_3pt_era'
  END AS reconciliation
FROM bref_keyed bk
FULL OUTER JOIN nba ON nba.player_id = bk.person_id AND nba.season = bk.season
`.trim();

const db = await DuckDBInstance.fromCache(DB_PATH);
const conn = await db.connect();
const q = async (sql: string) => (await conn.runAndReadAll(sql)).getRowObjectsJson();

// Always validate read-only first.
const buckets = (
  await q(`
  SELECT
    count(*) AS n_total,
    count(*) FILTER (WHERE reconciliation = 'agree') AS n_agree,
    count(*) FILTER (WHERE reconciliation = 'disagree') AS n_disagree,
    count(*) FILTER (WHERE reconciliation = 'bref_only') AS n_bref_only,
    count(*) FILTER (WHERE reconciliation = 'nba_only') AS n_nba_only,
    count(*) FILTER (WHERE reconciliation = 'no_3pt_era') AS n_no_3pt_era
  FROM (${SELECT_SQL})
`)
)[0];

console.log('Read-only validation of', VIEW_NAME);
console.table(buckets);

if (!args.has('--apply')) {
  console.log('\nDry run (no catalog changes). Re-run with --apply to persist the view.');
} else {
  await conn.run(`CREATE OR REPLACE VIEW ${VIEW_NAME} AS ${SELECT_SQL}`);
  const check = (await q(`SELECT count(*) AS n FROM ${VIEW_NAME}`))[0];
  console.log(`\nApplied CREATE OR REPLACE VIEW ${VIEW_NAME}. View returns ${check.n} rows.`);
}
