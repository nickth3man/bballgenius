import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanMarkdownText, parseBbrMarkdown } from '../tabs/timeMachine/utils/bbr/bbrParser.js';

describe('Basketball-Reference Integration Parser', () => {
  const firecrawlDir = join(import.meta.dirname, '..', '..', '.firecrawl');

  test('cleanMarkdownText removes markdown formatting', () => {
    expect(cleanMarkdownText('[LeBron James](https://url)')).toBe('LeBron James');
    expect(cleanMarkdownText('**Anthony Leon Tucker**')).toBe('Anthony Leon Tucker');
    expect(cleanMarkdownText('*Tuck Wagon*')).toBe('Tuck Wagon');
    expect(cleanMarkdownText('6-5,\u00a0245lb')).toBe('6-5, 245lb');
  });

  test('parses LeBron James player profile perfectly', () => {
    const filePath = join(firecrawlDir, 'bbr-player-lebron.md');
    const content = readFileSync(filePath, 'utf-8');
    const data = parseBbrMarkdown(content);

    expect(data.title).toContain('LeBron James');
    expect(data.tables.length).toBeGreaterThan(0);

    // Verify some table structure
    const statsTable = data.tables.find(
      (t) => t.title.toLowerCase().includes('totals') || t.title.toLowerCase().includes('per game'),
    );
    if (statsTable) {
      expect(statsTable.headers).toContain('Season');
      expect(statsTable.headers).toContain('Age');
      expect(statsTable.rows.length).toBeGreaterThan(0);
      expect(statsTable.rows[0]).toHaveProperty('Season');
    }
  });

  test('parses P.J. Tucker game logs, splits, and shooting', () => {
    // 1. Gamelog
    const gamelogPath = join(firecrawlDir, 'bbr-tucker-gamelog-2024.md');
    const gamelogContent = readFileSync(gamelogPath, 'utf-8');
    const gamelogData = parseBbrMarkdown(gamelogContent);
    expect(gamelogData.title).toContain('P.J. Tucker 2023-24 Game Log');

    const gamelogTable = gamelogData.tables.find((t) => t.headers.includes('Date'));
    expect(gamelogTable).toBeDefined();
    expect(gamelogTable!.headers).toContain('Result');
    expect(gamelogTable!.rows.length).toBeGreaterThan(0);
    expect(gamelogTable!.rows[0]['Date']).toBe('2023-10-26');

    // 2. Splits
    const splitsPath = join(firecrawlDir, 'bbr-tucker-splits-2024.md');
    const splitsContent = readFileSync(splitsPath, 'utf-8');
    const splitsData = parseBbrMarkdown(splitsContent);
    expect(splitsData.title).toContain('P.J. Tucker 2023-24 Splits');

    const splitsTable = splitsData.tables.find((t) => t.headers.includes('Split'));
    expect(splitsTable).toBeDefined();
    expect(splitsTable!.rows.length).toBeGreaterThan(0);

    // 3. Shooting
    const shootingPath = join(firecrawlDir, 'bbr-tucker-shooting-2024.md');
    const shootingContent = readFileSync(shootingPath, 'utf-8');
    const shootingData = parseBbrMarkdown(shootingContent);
    expect(shootingData.title).toContain('P.J. Tucker 2023-24 Shooting');

    const shootingTable = shootingData.tables.find((t) => t.headers.includes('Split'));
    expect(shootingTable).toBeDefined();
    expect(shootingTable!.rows.length).toBeGreaterThan(0);
  });

  test('parses other dynamic categories', () => {
    // Career Leaders PTS
    const leadersPath = join(firecrawlDir, 'bbr-leaders-career-pts.md');
    const leadersContent = readFileSync(leadersPath, 'utf-8');
    const leadersData = parseBbrMarkdown(leadersContent);
    expect(leadersData.title).toContain('Leaders');

    // Shot Chart
    const shotChartPath = join(firecrawlDir, 'bbr-game-shot-chart.md');
    const shotChartContent = readFileSync(shotChartPath, 'utf-8');
    const shotChartData = parseBbrMarkdown(shotChartContent);
    expect(shotChartData.title).toContain('Dallas Mavericks at Boston Celtics Shot Charts');

    // Season Summary 2024
    const seasonPath = join(firecrawlDir, 'bbr-season-2024.md');
    const seasonContent = readFileSync(seasonPath, 'utf-8');
    const seasonData = parseBbrMarkdown(seasonContent);
    expect(seasonData.title).toContain('Season Summary');

    // Playoffs Summary 2024
    const playoffsPath = join(firecrawlDir, 'bbr-playoffs-2024.md');
    const playoffsContent = readFileSync(playoffsPath, 'utf-8');
    const playoffsData = parseBbrMarkdown(playoffsContent);
    expect(playoffsData.title).toContain('Playoffs Summary');

    // Draft History 2024
    const draftPath = join(firecrawlDir, 'bbr-draft-2024.md');
    const draftContent = readFileSync(draftPath, 'utf-8');
    const draftData = parseBbrMarkdown(draftContent);
    expect(draftData.title).toContain('Draft');

    // Contracts CLE
    const contractsPath = join(firecrawlDir, 'bbr-contracts-cle.md');
    const contractsContent = readFileSync(contractsPath, 'utf-8');
    const contractsData = parseBbrMarkdown(contractsContent);
    expect(contractsData.title).toContain('Cleveland Cavaliers');

    // All-Star Game 2016
    const allstarPath = join(firecrawlDir, 'bbr-allstar-2016.md');
    const allstarContent = readFileSync(allstarPath, 'utf-8');
    const allstarData = parseBbrMarkdown(allstarContent);
    expect(allstarData.title).toContain('All-Star Game');

    // Play-by-Play game
    const pbpPath = join(firecrawlDir, 'bbr-game-pbp.md');
    const pbpContent = readFileSync(pbpPath, 'utf-8');
    const pbpData = parseBbrMarkdown(pbpContent);
    expect(pbpData.title).toContain('Play-By-Play');
  });

  test('bbrScraper builds URLs and fetches cached files offline', async () => {
    const { getBbrUrl, fetchBbrPage, fetchBbrGeneralPage, fetchMirroredPage } = await import(
      '../tabs/timeMachine/utils/bbr/bbrScraper.js'
    );

    expect(getBbrUrl('tuckepj01', 'profile')).toBe(
      'https://www.basketball-reference.com/players/t/tuckepj01.html',
    );
    expect(getBbrUrl('tuckepj01', 'gamelog', '2024')).toBe(
      'https://www.basketball-reference.com/players/t/tuckepj01/gamelog/2024',
    );
    expect(getBbrUrl('judkije01', 'gamelog-playoffs')).toBe(
      'https://www.basketball-reference.com/players/j/judkije01/gamelog-playoffs',
    );

    const lebronProfile = await fetchBbrPage('jamesle01', 'profile');
    expect(lebronProfile).toContain('LeBron James');

    const tuckerGamelog = await fetchBbrPage('tuckepj01', 'gamelog', '2024');
    expect(tuckerGamelog).toContain('P.J. Tucker 2023-24 Game Log');

    const draftPage = await fetchBbrGeneralPage('draft', '2024');
    expect(draftPage).toContain('Draft');

    const contractsPage = await fetchBbrGeneralPage('contracts', 'CLE');
    expect(contractsPage).toContain('Cleveland Cavaliers');

    const jokicProfile = await fetchBbrPage('jokicni01', 'profile');
    expect(jokicProfile).toContain('Nikola Jokic');

    const teamsIndex = fetchMirroredPage('teams/index.html');
    expect(teamsIndex.toLowerCase()).toContain('team');
  });

  test('mirrored store indexes screenshot JSON catalog', async () => {
    const { listMirroredPages, clearMirroredPageCache } = await import(
      '../tabs/timeMachine/utils/bbr/bbrMirroredStore.js'
    );
    const { buildSiteCatalog } = await import('../tabs/timeMachine/utils/bbr/bbrSiteCatalog.js');
    const { getDepthChain, loadDepthSamples, orderSectionPages } = await import(
      '../tabs/timeMachine/utils/bbr/bbrDepthCatalog.js'
    );

    clearMirroredPageCache();
    const pages = listMirroredPages();
    expect(pages.length).toBeGreaterThan(100);

    const catalog = buildSiteCatalog();
    expect(catalog.some((s) => s.id === 'players')).toBe(true);
    expect(catalog.some((s) => s.id === 'teams')).toBe(true);
    expect(catalog.some((s) => s.id === 'wnba')).toBe(true);

    const depthSamples = loadDepthSamples();
    expect(depthSamples.length).toBeGreaterThanOrEqual(15);
    expect(getDepthChain('awards').map((pick) => pick.depth)).toEqual([1, 2]);

    const awardsSection = catalog.find((s) => s.id === 'awards');
    expect(awardsSection).toBeDefined();
    const ordered = orderSectionPages('awards', awardsSection!.pages);
    expect(ordered[0]?.relativePath).toBe('awards/index.html');
    expect(ordered.some((page) => page.relativePath === 'awards/awards_1977.html')).toBe(true);
  });

  test('parseBbrPlayerSublinks extracts playoff log categories', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { parseBbrPlayerSublinks } = await import('../tabs/timeMachine/utils/bbr/bbrParser.js');

    const content = readFileSync(join(firecrawlDir, 'players/j/judkije01.html.md'), 'utf-8');
    const links = parseBbrPlayerSublinks(content);
    expect(links.splits.length).toBeGreaterThan(0);
  });
});
