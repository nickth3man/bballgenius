/**
 * Deterministic DB-truth layer for the eval harness.
 *
 * Resolves the *database's own* answer for a given groundTruthId by running
 * canonical SQL directly (NOT through the agent). This is one leg of the
 * three-way comparison performed by the harness:
 *
 *   agent answer  vs  DB value  vs  BBR value (eval/bbr-truth.json)
 *
 *   - DB value disagrees with BBR  -> data quality issue (the DB is wrong)
 *   - agent answer disagrees with DB -> agent bug (bad SQL / hallucination)
 *
 * All SQL here was validated live against the DuckDB warehouse. Career totals
 * sum main.fact_bref_player_season_totals (regular season, excluding combined
 * multi-team rows). Season leaders / standings use the curated api.* views.
 */

import { query } from '../db.js';

export interface DbTruthResult {
  /** The groundTruthId requested. */
  id: string;
  /** False when no canonical SQL is defined for this id (harness then skips the DB-vs-BBR leg). */
  supported: boolean;
  /** The resolved scalar/string value, or null when unsupported / not found. */
  value: string | number | null;
  /** Optional secondary fields (e.g. record losses, leader value). */
  extra?: Record<string, unknown>;
  /** The SQL that produced the value, for trace/debugging. */
  sql?: string;
  error?: string;
}

const CAREER_STAT_COLUMN: Record<string, string> = {
  points: 'pts',
  assists: 'ast',
  rebounds: 'trb',
  steals: 'stl',
  blocks: 'blk',
  three_pointers: 'x3p',
};

const CAREER_LEADER_TABLE: Record<string, string> = {
  career_points_leaders: 'pts',
  career_assists_leaders: 'ast',
  career_rebounds_leaders: 'trb',
  career_steals_leaders: 'stl',
  career_blocks_leaders: 'blk',
  career_three_pointers_leaders: 'x3p',
};

/** Canonical career-totals subquery: regular season, exclude combined multi-team (2TM/3TM/TOT) rows. */
function careerTotalsSql(col: string): string {
  return `SELECT player_name, SUM(${col}) AS total
          FROM main.fact_bref_player_season_totals
          WHERE is_playoffs = false AND team NOT LIKE '%TM%' AND team <> 'TOT'
          GROUP BY player_name`;
}

/** "2023-24" -> 2024 (season_end_year). */
function seasonEndYear(season: string): number | null {
  const m = season.match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const startCentury = Math.floor(Number(m[1]) / 100) * 100;
  const end = startCentury + Number(m[2]);
  // Handle century rollover, e.g. 1999-00 -> 2000.
  return end < Number(m[1]) ? end + 100 : end;
}

const TEAM_ABBREV: Record<string, string> = {
  Boston_Celtics: 'BOS',
  Golden_State_Warriors: 'GSW',
};

function unsupported(id: string): DbTruthResult {
  return { id, supported: false, value: null };
}

/**
 * Resolve a groundTruthId to the database's own value.
 *
 * Supported id shapes:
 *   career_<stat>_leaders.<rank>
 *   player_career_totals.<Player_Name>.<stat>
 *   mvp_winners.<season>                 e.g. mvp_winners.2023-24
 *   mvp_winners.<Player_Name>            -> MVP count (number)
 *   team_records.<Team_Year>             e.g. team_records.Boston_Celtics_2024 -> "W-L"
 *   season_leaders_2024.<stat>.<rank>    stat in points_per_game | rebounds_per_game | assists_per_game
 */
export async function resolveDbValue(id: string): Promise<DbTruthResult> {
  try {
    const parts = id.split('.');
    const head = parts[0] ?? '';
    const p = (i: number): string => parts[i] ?? '';

    // --- career_<stat>_leaders.<rank> ---
    if (head in CAREER_LEADER_TABLE) {
      const col = CAREER_LEADER_TABLE[head];
      if (!col) return unsupported(id);
      const rank = Number(p(1));
      if (!Number.isFinite(rank) || rank < 1) return unsupported(id);
      const sql = `${careerTotalsSql(col)} ORDER BY total DESC LIMIT 1 OFFSET ${rank - 1}`;
      const rows = await query<{ player_name: string; total: number }>(sql);
      const top = rows[0];
      if (!top) return { id, supported: true, value: null, sql };
      return {
        id,
        supported: true,
        value: top.player_name,
        extra: { total: Number(top.total) },
        sql,
      };
    }

    // --- player_career_totals.<Player_Name>[.<stat>] ---
    if (head === 'player_career_totals') {
      const playerName = p(1).replace(/_/g, ' ');
      const stat = p(2);
      if (!playerName) return unsupported(id);
      // Whole-player id (no stat) is used by comparison questions; return points as the representative scalar.
      const col = CAREER_STAT_COLUMN[stat || 'points'];
      if (!col) return unsupported(id);
      const sql = `SELECT SUM(${col}) AS total
                   FROM main.fact_bref_player_season_totals
                   WHERE is_playoffs = false AND team NOT LIKE '%TM%' AND team <> 'TOT'
                     AND player_name = '${playerName.replace(/'/g, "''")}'`;
      const rows = await query<{ total: number }>(sql);
      const total = rows[0]?.total;
      return { id, supported: true, value: total == null ? null : Number(total), sql };
    }

    // --- mvp_winners.<season> | mvp_winners.<Player_Name> ---
    if (head === 'mvp_winners') {
      const arg = parts.slice(1).join('.');
      const asYear = seasonEndYear(arg);
      if (asYear != null) {
        const sql = `SELECT player_name FROM main.fact_player_award_vote
                     WHERE lower(award) = 'nba mvp' AND winner = true AND season_end_year = ${asYear}`;
        const rows = await query<{ player_name: string }>(sql);
        return { id, supported: true, value: rows[0]?.player_name ?? null, sql };
      }
      // Player MVP count.
      const playerName = arg.replace(/_/g, ' ');
      const sql = `SELECT count(*) AS c FROM main.fact_player_award_vote
                   WHERE lower(award) = 'nba mvp' AND winner = true
                     AND player_name = '${playerName.replace(/'/g, "''")}'`;
      const rows = await query<{ c: number }>(sql);
      return { id, supported: true, value: Number(rows[0]?.c ?? 0), sql };
    }

    // --- team_records.<Team_Year> ---
    if (head === 'team_records') {
      const key = parts.slice(1).join('.');
      const m = key.match(/^(.+)_(\d{4})$/);
      if (!m?.[1] || !m[2]) return unsupported(id);
      const abbrev = TEAM_ABBREV[m[1]];
      if (!abbrev) return unsupported(id);
      const endYear = Number(m[2]);
      // NOTE: api.v_team_standings blends regular season + playoffs + Cup (no season_type
      // column; games_played is 100+). Use the bref team-season summary for the clean
      // regular-season W-L instead. (The is_playoffs flag on this row is unreliable, so we
      // do not filter on it — there is exactly one summary row per team/season.)
      const sql = `SELECT w AS wins, l AS losses FROM main.fact_bref_team_season_summary
                   WHERE season_end_year = ${endYear} AND abbreviation = '${abbrev}' LIMIT 1`;
      const rows = await query<{ wins: number; losses: number }>(sql);
      const rec = rows[0];
      if (!rec) return { id, supported: true, value: null, sql };
      return {
        id,
        supported: true,
        value: `${rec.wins}-${rec.losses}`,
        extra: { wins: Number(rec.wins), losses: Number(rec.losses) },
        sql,
      };
    }

    // --- season_leaders_2024.<stat>.<rank> ---
    if (head === 'season_leaders_2024') {
      const statMap: Record<string, { col: string; rank: string }> = {
        points_per_game: { col: 'avg_pts', rank: 'pts_rank' },
        rebounds_per_game: { col: 'avg_reb', rank: 'reb_rank' },
        assists_per_game: { col: 'avg_ast', rank: 'ast_rank' },
      };
      const cfg = statMap[p(1)];
      const rank = Number(p(2) || 1);
      if (!cfg) return unsupported(id);
      const sql = `SELECT DISTINCT full_name, ${cfg.col} AS val FROM api.v_season_leaders
                   WHERE season_year = '2023-24' AND season_type = 'Regular' AND ${cfg.rank} = '${rank}'`;
      const rows = await query<{ full_name: string; val: number }>(sql);
      const top = rows[0];
      if (!top) return { id, supported: true, value: null, sql };
      return { id, supported: true, value: top.full_name, extra: { value: Number(top.val) }, sql };
    }

    // single_games.* and anything else: not resolvable via canonical SQL yet.
    return unsupported(id);
  } catch (e) {
    return { id, supported: false, value: null, error: e instanceof Error ? e.message : String(e) };
  }
}
