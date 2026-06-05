import { beforeEach, describe, expect, mock, test } from 'bun:test';

let queries: string[] = [];

mock.module('../../../core/db.js', () => ({
  query: async (sql: string, params?: unknown[]) => {
    if (params?.[0] === '99999') {
      throw new Error('Simulated DB error');
    }

    queries.push(sql);

    // loadPlayerMeta — enriched
    if (sql.includes('FROM main.dim_player p')) {
      return [
        {
          person_id: '77459',
          full_name: 'Pete Maravich',
          bref_player_id: 'maravpe01',
          primary_position: 'G',
          height_inches: 77,
          body_weight_lbs: 197,
          birth_date: '1947-06-22',
          school: 'LSU',
          country: null,
          draft_year: 1970,
          draft_round: 1,
          draft_number: 3,
          from_year: 1970,
          to_year: 1980,
          is_hall_of_fame: true,
        },
      ];
    }

    // loadPlayerCareerTotals
    if (sql.includes('api.v_player_career')) {
      return [
        {
          player_id: '77459',
          full_name: 'Pete Maravich',
          position: 'G',
          career_gp: '684',
          career_min: 63478,
          career_pts: 48029,
          career_ppg: 24.37,
          career_rpg: 4.04,
          career_apg: 5.2,
          career_spg: 0.3,
          career_bpg: 0.06,
          career_fg_pct: 0.469,
          career_fg3_pct: 0.679,
          career_ft_pct: 0.816,
          first_season: '1970-71',
          last_season: '1979-80',
          seasons_played: '10',
        },
      ];
    }

    // loadPlayerDraft
    if (sql.includes('fact_draft_pick_bref')) {
      return [
        {
          season_end_year: 1970,
          overall_pick: 3,
          round: 1,
          team: 'ATL',
          bref_player_id: 'maravpe01',
          player_name: 'Pete Maravich',
        },
      ];
    }

    // loadPlayerCombine
    if (sql.includes('api.v_draft_combine')) {
      return [
        {
          season: '2003',
          player_id: '2544',
          player_name: 'LeBron James',
          position: 'G',
          height_wo_shoes: 79.25,
          height_w_shoes: null,
          weight: 245,
          wingspan: 84.25,
          standing_reach: 106.25,
          body_fat_pct: 6.7,
          hand_length: null,
          hand_width: null,
          standing_vertical_leap: null,
          max_vertical_leap: null,
          lane_agility_time: null,
          modified_lane_agility_time: null,
          three_quarter_sprint: null,
          bench_press: null,
        },
      ];
    }

    // loadPlayerAllStarSelections
    if (sql.includes('fact_all_star_selection')) {
      return [
        { season_end_year: 1973, player_name: 'Pete Maravich', team: 'East', replaced: false },
        { season_end_year: 1974, player_name: 'Pete Maravich', team: 'East', replaced: false },
        { season_end_year: 1977, player_name: 'Pete Maravich', team: 'East', replaced: false },
        { season_end_year: 1978, player_name: 'Pete Maravich', team: 'East', replaced: true },
        { season_end_year: 1979, player_name: 'Pete Maravich', team: 'East', replaced: false },
      ];
    }

    // loadPlayerAwardVotes
    if (sql.includes('fact_player_award_vote')) {
      return [
        {
          season_end_year: 1977,
          award: 'nba mvp',
          age: 29,
          first: 15,
          pts_won: 15,
          pts_max: 247,
          share: 0.061,
          winner: false,
        },
        {
          season_end_year: 1971,
          award: 'nba roy',
          age: 23,
          first: 21,
          pts_won: 21,
          pts_max: 98,
          share: 0.214,
          winner: false,
        },
      ];
    }

    // loadPlayerPerGame
    if (sql.includes('fact_bref_player_season_per_game')) {
      return [
        {
          season_end_year: 1971,
          age: 23,
          team: 'ATL',
          pos: 'SG',
          g: 81,
          gs: null,
          mp_per_game: 36.1,
          fg_per_game: 9.5,
          fga_per_game: 21.5,
          fg_percent: 0.441,
          x3p_per_game: null,
          x3pa_per_game: null,
          x3p_percent: null,
          ft_per_game: 4.2,
          fta_per_game: 5.3,
          ft_percent: 0.8,
          orb_per_game: null,
          drb_per_game: null,
          trb_per_game: 3.7,
          ast_per_game: 4.4,
          stl_per_game: null,
          blk_per_game: null,
          tov_per_game: null,
          pf_per_game: 2.8,
          pts_per_game: 23.2,
        },
      ];
    }

    // loadPlayerTotals
    if (sql.includes('fact_bref_player_season_totals')) {
      return [
        {
          season_end_year: 1971,
          age: 23,
          team: 'ATL',
          pos: 'SG',
          g: 81,
          gs: null,
          mp: 2924,
          fg: 769,
          fga: 1744,
          fg_percent: 0.441,
          x3p: null,
          x3pa: null,
          x3p_percent: null,
          ft: 343,
          fta: 429,
          ft_percent: 0.8,
          orb: null,
          drb: null,
          trb: 299,
          ast: 358,
          stl: null,
          blk: null,
          tov: null,
          pf: 230,
          pts: 1881,
          trp_dbl: null,
        },
      ];
    }

    // loadPlayerPer36
    if (sql.includes('fact_bref_player_season_per36')) {
      return [
        {
          season_end_year: 1971,
          age: 23,
          team: 'ATL',
          pos: 'SG',
          g: 81,
          gs: null,
          mp: 2924,
          fg_per_36_min: 9.5,
          fga_per_36_min: 21.5,
          fg_percent: 0.441,
          x3p_per_36_min: null,
          x3pa_per_36_min: null,
          x3p_percent: null,
          ft_per_36_min: 4.2,
          fta_per_36_min: 5.3,
          ft_percent: 0.8,
          orb_per_36_min: null,
          drb_per_36_min: null,
          trb_per_36_min: 3.7,
          ast_per_36_min: 4.4,
          stl_per_36_min: null,
          blk_per_36_min: null,
          tov_per_36_min: null,
          pf_per_36_min: 2.8,
          pts_per_36_min: 23.2,
        },
      ];
    }

    // loadPlayerAdvanced
    if (sql.includes('fact_bref_player_season_advanced')) {
      return [
        {
          season_end_year: 1971,
          age: 23,
          team: 'ATL',
          pos: 'SG',
          g: 81,
          gs: null,
          mp: 2924,
          per: 17.8,
          ts_percent: 0.512,
          x3p_ar: null,
          f_tr: null,
          orb_percent: null,
          drb_percent: null,
          trb_percent: null,
          ast_percent: null,
          stl_percent: null,
          blk_percent: null,
          tov_percent: null,
          usg_percent: null,
          ows: 6.2,
          dws: null,
          ws: 6.2,
          ws_48: null,
          obpm: null,
          dbpm: null,
          bpm: null,
          vorp: null,
        },
      ];
    }

    // loadPlayerShooting
    if (sql.includes('fact_bref_player_season_shooting')) {
      return [];
    }

    // loadPlayerPlayByPlay
    if (sql.includes('fact_bref_player_season_play_by_play')) {
      return [];
    }

    // loadPlayerGameLog
    if (sql.includes('nbadb.fact_player_game_log')) {
      return [
        {
          game_date: '1977-04-10',
          matchup: 'NOP @ ATL',
          wl: 'W',
          min: 42,
          pts: 35,
          reb: 5,
          ast: 8,
          stl: 2,
          blk: 0,
          plus_minus: null,
          fgm: 14,
          fga: 28,
          fg_pct: 0.5,
          fg3m: null,
          fg3a: null,
          fg3_pct: null,
          ftm: 7,
          fta: 8,
          ft_pct: 0.875,
          oreb: 1,
          dreb: 4,
          tov: 3,
          pf: 2,
        },
      ];
    }

    // loadPlayerFranchiseStanding — full table scan
    if (sql.includes('api.v_franchise_leaders')) {
      return [
        {
          team: 'NOP',
          pts: 15,
          pts_player: 'Pete Maravich',
          pts_person_id: '77459',
          reb: 7,
          reb_player: 'Some Player',
          reb_person_id: '99999',
          ast: 8,
          ast_player: 'Pete Maravich',
          ast_person_id: '77459',
          stl: 3,
          stl_player: 'Pete Maravich',
          stl_person_id: '77459',
          blk: 1,
          blk_player: 'Other Player',
          blk_person_id: '88888',
        },
      ];
    }

    // loadPlayerShotZones — name lookup
    if (sql.includes('unified_star.dim_player')) {
      return [{ full_name: 'Pete Maravich' }];
    }

    // loadPlayerShotZones — shot chart aggregation
    if (sql.includes('api.v_shot_chart')) {
      return [
        { shot_zone_basic: 'Mid-Range', fga: 100, fgm: 45 },
        { shot_zone_basic: 'Above the Break 3', fga: 50, fgm: 18 },
      ];
    }

    // v_player_honors_full — used by loadPlayerAwards
    if (sql.includes('v_player_honors_full')) {
      return [
        { award: 'All-NBA 1st', season_year: 1977, count: 1 },
        { award: 'All-Rookie 1st', season_year: 1971, count: 1 },
      ];
    }

    // loadCareerStats — fact_player_season_stats with is_playoffs
    if (sql.includes('fact_player_season_stats')) {
      return [
        {
          season_year: '1970-71',
          is_playoffs: false,
          gp: 81,
          gs: null,
          min: 2924,
          pts: 1881,
          ast: 358,
          reb: 299,
          stl: null,
          blk: null,
          ts_pct: 0.512,
          per: 17.8,
          bpm: null,
          vorp: null,
        },
        {
          season_year: '1970-71',
          is_playoffs: true,
          gp: 5,
          gs: null,
          min: 180,
          pts: 110,
          ast: 20,
          reb: 18,
          stl: null,
          blk: null,
          ts_pct: 0.48,
          per: 15.2,
          bpm: null,
          vorp: null,
        },
      ];
    }

    // Default fallback for fact_player_awards
    return [
      { award: 'nba mvp', season_year: '1976-77', count: 1 },
      { award: 'nba roy', season_year: '1970-71', count: 1 },
    ];
  },
}));

mock.module('../../../core/dbHonors.js', () => ({
  isHonorsDbConfigured: () => false,
  queryHonors: async () => [],
}));

describe('loadPlayerDossier', () => {
  beforeEach(() => {
    queries = [];
  });

  test('returns the bundle shape with real data for each section', async () => {
    const { loadPlayerDossier } = await import('../queries.js');
    const dossier = await loadPlayerDossier('77459');

    expect(dossier).toBeDefined();
    expect(dossier.meta).not.toBeNull();
    expect(dossier.meta!.person_id).toBe('77459');
    expect(dossier.meta!.full_name).toBe('Pete Maravich');
    expect(dossier.meta!.bref_player_id).toBe('maravpe01');

    // Totals
    expect(dossier.totals).not.toBeNull();
    expect(dossier.totals!.full_name).toBe('Pete Maravich');
    expect(dossier.totals!.career_ppg).toBeCloseTo(24.37, 1);

    // Draft
    expect(dossier.draft).not.toBeNull();
    expect(dossier.draft!.overall_pick).toBe(3);
    expect(dossier.draft!.team).toBe('ATL');

    // Combine
    expect(dossier.combine).not.toBeNull();
    expect(dossier.combine!.player_name).toBe('LeBron James');

    // Awards
    expect(dossier.awards.length).toBeGreaterThan(0);
    expect(dossier.awards[0].award).toBe('All-NBA 1st');

    // All-Star
    expect(dossier.allStar.length).toBe(5);
    expect(dossier.allStar[0].season_end_year).toBe(1973);
    expect(dossier.allStar[3].replaced).toBe(true);

    // Votes
    expect(dossier.votes.length).toBe(2);
    expect(dossier.votes[0].award).toBe('nba mvp');

    // Per-game
    expect(dossier.perGame.length).toBe(1);
    expect(dossier.perGame[0].pts_per_game).toBeCloseTo(23.2, 1);

    // Season totals
    expect(dossier.totalsSeason.length).toBe(1);
    expect(dossier.totalsSeason[0].pts).toBe(1881);

    // Per36
    expect(dossier.per36.length).toBe(1);
    expect(dossier.per36[0].pts_per_36_min).toBeCloseTo(23.2, 1);

    // Advanced
    expect(dossier.advanced.length).toBe(1);
    expect(dossier.advanced[0].per).toBeCloseTo(17.8, 1);
    expect(dossier.advanced[0].ws).toBeCloseTo(6.2, 1);

    // Shooting / play-by-play (empty for old-era player)
    expect(dossier.shooting).toEqual([]);
    expect(dossier.playByPlay).toEqual([]);

    // Game log
    expect(dossier.gameLog.length).toBe(1);
    expect(dossier.gameLog[0].game_date).toBe('1977-04-10');
    expect(dossier.gameLog[0].pts).toBe(35);

    // Franchise standing
    expect(dossier.franchise.length).toBe(3);
    expect(dossier.franchise.map((f) => f.category).sort()).toEqual(['AST', 'PTS', 'STL']);

    // Shot zones
    expect(dossier.shotZones.length).toBe(2);
    expect(dossier.shotZones[0].zone).toBe('Mid-Range');
    expect(dossier.shotZones[0].fg_pct).toBeCloseTo(0.45, 2);

    // Career stats — regular season + playoffs
    expect(dossier.careerStats).toBeDefined();
    expect(dossier.careerStats.length).toBe(2);
    const reg = dossier.careerStats.find((s) => !s.is_playoffs);
    const poff = dossier.careerStats.find((s) => s.is_playoffs);
    expect(reg).toBeDefined();
    expect(reg!.season_year).toBe('1970-71');
    expect(reg!.pts).toBe(1881);
    expect(poff).toBeDefined();
    expect(poff!.season_year).toBe('1970-71');
    expect(poff!.pts).toBe(110);
  });
});

describe('loadPlayerDossier with errors', () => {
  beforeEach(() => {
    queries = [];
  });

  test('returns defaults when every query throws', async () => {
    const { loadPlayerDossier } = await import('../queries.js');
    const dossier = await loadPlayerDossier('99999');

    expect(dossier.meta).toBeNull();
    expect(dossier.totals).toBeNull();
    expect(dossier.draft).toBeNull();
    expect(dossier.combine).toBeNull();
    expect(dossier.awards).toEqual([]);
    expect(dossier.allStar).toEqual([]);
    expect(dossier.votes).toEqual([]);
    expect(dossier.perGame).toEqual([]);
    expect(dossier.totalsSeason).toEqual([]);
    expect(dossier.per36).toEqual([]);
    expect(dossier.advanced).toEqual([]);
    expect(dossier.shooting).toEqual([]);
    expect(dossier.playByPlay).toEqual([]);
    expect(dossier.gameLog).toEqual([]);
    expect(dossier.franchise).toEqual([]);
    expect(dossier.shotZones).toEqual([]);
    expect(dossier.careerStats).toEqual([]);
  });
});

describe('groupAwardsByCategory', () => {
  test('groups awards by leading token', async () => {
    const { groupAwardsByCategory } = await import('../queries.js');

    const input = [
      { award: 'All-NBA 1st', season_year: '1976-77', count: 1 },
      { award: 'All-NBA 2nd', season_year: '1972-73', count: 1 },
      { award: 'All-Rookie 1st', season_year: '1970-71', count: 1 },
      { award: 'All-Star', season_year: '1976-77', count: 1 },
    ];

    const grouped = groupAwardsByCategory(input);

    expect(grouped.length).toBe(3);

    const allNba = grouped.find((g) => g.category === 'All-NBA');
    expect(allNba).toBeDefined();
    expect(allNba!.awards.length).toBe(2);
    // All-NBA groups sort by team number: 1st before 2nd
    expect(allNba!.awards[0].label).toBe('All-NBA 1st');
    expect(allNba!.awards[1].label).toBe('All-NBA 2nd');

    const allRookie = grouped.find((g) => g.category === 'All-Rookie');
    expect(allRookie).toBeDefined();
    expect(allRookie!.awards.length).toBe(1);

    const allStar = grouped.find((g) => g.category === 'All-Star');
    expect(allStar).toBeDefined();
    expect(allStar!.awards.length).toBe(1);
  });

  test('returns empty array for empty input', async () => {
    const { groupAwardsByCategory } = await import('../queries.js');
    expect(groupAwardsByCategory([])).toEqual([]);
  });
});
