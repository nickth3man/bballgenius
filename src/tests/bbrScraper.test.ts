import { describe, expect, test } from 'bun:test';
import {
  getBbrGeneralUrlAndCachePath,
  getBbrUrl,
} from '../tabs/timeMachine/utils/bbr/bbrScraper.js';

describe('bbrScraper', () => {
  describe('getBbrUrl', () => {
    test('builds profile URL with initial directory', () => {
      const url = getBbrUrl('jamesle01', 'profile');
      expect(url).toBe('https://www.basketball-reference.com/players/j/jamesle01.html');
    });

    test('builds gamelog URL with year', () => {
      const url = getBbrUrl('jamesle01', 'gamelog', '2024');
      expect(url).toBe('https://www.basketball-reference.com/players/j/jamesle01/gamelog/2024');
    });

    test('builds gamelog URL without year', () => {
      const url = getBbrUrl('jamesle01', 'gamelog');
      expect(url).toBe('https://www.basketball-reference.com/players/j/jamesle01/gamelog');
    });

    test('builds splits URL with year', () => {
      const url = getBbrUrl('currse01', 'splits', '2024');
      expect(url).toBe('https://www.basketball-reference.com/players/c/currse01/splits/2024');
    });

    test('builds shooting URL with year', () => {
      const url = getBbrUrl('jamesle01', 'shooting', '2023');
      expect(url).toBe('https://www.basketball-reference.com/players/j/jamesle01/shooting/2023');
    });

    test('builds lineups URL', () => {
      const url = getBbrUrl('jamesle01', 'lineups', '2024');
      expect(url).toBe('https://www.basketball-reference.com/players/j/jamesle01/lineups/2024');
    });

    test('builds on-off URL', () => {
      const url = getBbrUrl('jamesle01', 'on-off', '2024');
      expect(url).toBe('https://www.basketball-reference.com/players/j/jamesle01/on-off/2024');
    });

    test('builds gamelog-playoffs URL', () => {
      const url = getBbrUrl('jamesle01', 'gamelog-playoffs');
      expect(url).toBe('https://www.basketball-reference.com/players/j/jamesle01/gamelog-playoffs');
    });

    test('builds gamelog-playoffs-advanced URL', () => {
      const url = getBbrUrl('jamesle01', 'gamelog-playoffs-advanced');
      expect(url).toBe(
        'https://www.basketball-reference.com/players/j/jamesle01/gamelog-playoffs-advanced',
      );
    });

    test('builds gamelog-advanced URL with year', () => {
      const url = getBbrUrl('jamesle01', 'gamelog-advanced', '2024');
      expect(url).toBe(
        'https://www.basketball-reference.com/players/j/jamesle01/gamelog-advanced/2024',
      );
    });

    test('normalizes player ID to lowercase', () => {
      const url = getBbrUrl('JAMESLE01', 'profile');
      expect(url).toBe('https://www.basketball-reference.com/players/j/jamesle01.html');
    });

    test('trims whitespace from player ID', () => {
      const url = getBbrUrl('  jamesle01  ', 'profile');
      expect(url).toBe('https://www.basketball-reference.com/players/j/jamesle01.html');
    });
  });

  describe('getBbrGeneralUrlAndCachePath', () => {
    test('builds playoffs URL and cache path', () => {
      const result = getBbrGeneralUrlAndCachePath('playoffs', '2024');
      expect(result.url).toBe('https://www.basketball-reference.com/playoffs/NBA_2024.html');
      expect(result.cachePath).toContain('bbr-playoffs-2024.md');
    });

    test('builds draft URL and cache path', () => {
      const result = getBbrGeneralUrlAndCachePath('draft', '2024');
      expect(result.url).toBe('https://www.basketball-reference.com/draft/NBA_2024.html');
      expect(result.cachePath).toContain('bbr-draft-2024.md');
    });

    test('builds contracts URL with uppercase team', () => {
      const result = getBbrGeneralUrlAndCachePath('contracts', 'cle');
      expect(result.url).toBe('https://www.basketball-reference.com/contracts/CLE.html');
      expect(result.cachePath).toContain('bbr-contracts-cle.md');
    });

    test('builds allstar URL', () => {
      const result = getBbrGeneralUrlAndCachePath('allstar', '2024');
      expect(result.url).toBe('https://www.basketball-reference.com/allstar/NBA_2024.html');
      expect(result.cachePath).toContain('bbr-allstar-2024.md');
    });

    test('builds awards URL', () => {
      const result = getBbrGeneralUrlAndCachePath('awards', '2024');
      expect(result.url).toBe('https://www.basketball-reference.com/awards/awards_2024.html');
      expect(result.cachePath).toContain('bbr-awards-2024.md');
    });

    test('builds leaders_career URL', () => {
      const result = getBbrGeneralUrlAndCachePath('leaders_career', 'pts');
      expect(result.url).toBe('https://www.basketball-reference.com/leaders/pts_career.html');
      expect(result.cachePath).toContain('bbr-leaders-career-pts.md');
    });

    test('builds leaders_season URL', () => {
      const result = getBbrGeneralUrlAndCachePath('leaders_season', 'pts');
      expect(result.url).toBe('https://www.basketball-reference.com/leagues/NBA_pts_leaders.html');
      expect(result.cachePath).toContain('bbr-leaders-season-pts.md');
    });

    test('builds season_summary URL', () => {
      const result = getBbrGeneralUrlAndCachePath('season_summary', '2024');
      expect(result.url).toBe('https://www.basketball-reference.com/leagues/NBA_2024.html');
      expect(result.cachePath).toContain('bbr-season-2024.md');
    });

    test('builds game_boxscore URL', () => {
      const result = getBbrGeneralUrlAndCachePath('game_boxscore', '202406060BOS');
      expect(result.url).toBe('https://www.basketball-reference.com/boxscores/202406060BOS.html');
      expect(result.cachePath).toContain('bbr-game-boxscore.md');
    });

    test('builds game_shot_chart URL', () => {
      const result = getBbrGeneralUrlAndCachePath('game_shot_chart', '202406060BOS');
      expect(result.url).toBe(
        'https://www.basketball-reference.com/boxscores/shot-chart/202406060BOS.html',
      );
      expect(result.cachePath).toContain('bbr-game-shot-chart.md');
    });

    test('builds game_pbp URL', () => {
      const result = getBbrGeneralUrlAndCachePath('game_pbp', '202406060BOS');
      expect(result.url).toBe(
        'https://www.basketball-reference.com/boxscores/pbp/202406060BOS.html',
      );
      expect(result.cachePath).toContain('bbr-game-pbp.md');
    });
  });
});
