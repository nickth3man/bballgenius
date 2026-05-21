import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const SCREENSHOT_DIR = join(import.meta.dirname, '..', 'bbr-screenshots');
if (!existsSync(SCREENSHOT_DIR)) {
  mkdirSync(SCREENSHOT_DIR);
}

// Seed URLs to kick off the dynamic crawler discovery
const SEED_URLS = [
  'https://www.basketball-reference.com/',
  'https://www.basketball-reference.com/players/',
  'https://www.basketball-reference.com/teams/',
  'https://www.basketball-reference.com/leagues/',
  'https://www.basketball-reference.com/boxscores/',
  'https://www.basketball-reference.com/players/j/jamesle01.html',
  'https://www.basketball-reference.com/players/t/tuckepj01.html',
];

/**
 * Classifies a Basketball-Reference URL into a distinct category based on path structures.
 */
function classifyUrl(urlStr: string): string | null {
  try {
    const url = new URL(urlStr);
    if (!url.hostname.includes('basketball-reference.com')) {
      return null;
    }

    const path = url.pathname;
    if (path === '/' || path === '') {
      return 'homepage';
    }

    // Players Structure
    if (path.startsWith('/players/')) {
      const parts = path.split('/').filter(Boolean); // e.g. ['players', 't', 'tuckepj01', 'gamelog', '2024']
      if (parts.length === 1) return 'players_index';
      if (parts.length === 3 && parts[2].endsWith('.html')) return 'player_profile';
      if (parts.length >= 4) {
        return `player_${parts[3]}`; // 'player_gamelog', 'player_splits', etc.
      }
    }

    // Leagues & Seasons Structure
    if (path.startsWith('/leagues/')) {
      const file = path.split('/').pop() || '';
      if (file === '') return 'leagues_index';
      if (file.includes('leaders')) return 'leaders_season';
      if (file.includes('ratings')) return 'leagues_ratings';
      return 'season_summary';
    }

    // Boxscores Structure
    if (path.startsWith('/boxscores/')) {
      if (path.includes('/shot-chart/')) return 'game_shot_chart';
      if (path.includes('/pbp/')) return 'game_pbp';
      const file = path.split('/').pop() || '';
      if (file === '' || file.includes('?')) return 'boxscores_index';
      return 'game_boxscore';
    }

    // General segment directories (e.g. /contracts/, /awards/, /draft/, /allstar/, /friv/)
    const firstSegment = path.split('/').filter(Boolean)[0];
    if (firstSegment) {
      // Clean up common file names or extensions
      return firstSegment.replace(/\.html?$/, '').replace(/\.fcgi?$/, '');
    }

    return 'general';
  } catch (_e) {
    return null;
  }
}

async function run() {
  console.log('[DEBUG] 🚀 Starting Basketball-Reference Dynamic Crawler & Screenshot Capturer...');
  console.log(`[DEBUG] Initial seeds: ${SEED_URLS.join(', ')}`);

  console.log(
    '[DEBUG] Launching Chromium browser with headless=true, sandbox-disabled arguments...',
  );
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  console.log('[DEBUG] Browser process successfully launched!');

  console.log('[DEBUG] Creating isolated browser context with viewport size 1280x800...');
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  console.log('[DEBUG] Context successfully created!');

  console.log('[DEBUG] Opening new browser tab/page...');
  const page = await context.newPage();
  console.log('[DEBUG] Browser page is now active and ready for navigation!');

  const visitedUrls = new Set<string>();
  const categoryCounts = new Map<string, number>();
  const urlQueue: string[] = [...SEED_URLS];

  // Maximum number of URLs we will crawl overall to prevent long hanging scripts
  const MAX_CRAWL_BUDGET = 200;
  let crawledCount = 0;

  console.log(`[DEBUG] Queue initialized with ${urlQueue.length} seed URLs.`);

  while (urlQueue.length > 0 && crawledCount < MAX_CRAWL_BUDGET) {
    const url = urlQueue.shift()!;
    console.log(`\n[DEBUG] [Queue Size: ${urlQueue.length}] Next candidate: ${url}`);

    if (visitedUrls.has(url)) {
      console.log('[DEBUG] URL already visited. Skipping.');
      continue;
    }
    visitedUrls.add(url);

    const category = classifyUrl(url);
    console.log(`[DEBUG] Classifying URL path: "${url}" -> category: "${category}"`);
    if (!category) {
      console.log('[DEBUG] URL is outside our target domain/patterns. Skipping.');
      continue;
    }

    const currentCount = categoryCounts.get(category) || 0;
    const shouldScreenshot = currentCount < 2;

    try {
      console.log(`\n[Crawl ${++crawledCount}/${MAX_CRAWL_BUDGET}] Navigating to: ${url}`);
      console.log(`  └─> Classification: ${category} (Captured so far: ${currentCount}/2)`);

      const startTime = Date.now();
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
      const elapsed = Date.now() - startTime;
      console.log(`      ✓ Page navigation complete in ${elapsed}ms!`);

      console.log('      ⏳ Waiting 1000ms for client-side JavaScript tables/assets to render...');
      await page.waitForTimeout(1000);

      if (shouldScreenshot) {
        const catDir = join(SCREENSHOT_DIR, category);
        if (!existsSync(catDir)) {
          console.log(`      📁 Creating category directory: ${catDir}`);
          mkdirSync(catDir, { recursive: true });
        }
        const filename = join(catDir, `${currentCount + 1}.png`);
        console.log(`      📸 Capturing page screenshot -> ${filename}...`);
        await page.screenshot({ path: filename });
        categoryCounts.set(category, currentCount + 1);
        console.log(`      ✓ Screenshot successfully saved to ${filename}`);
      } else {
        console.log(
          '      Bypassing screenshot (category has already reached the 2/2 screenshot cap).',
        );
      }

      console.log('      🔍 Scoping document for new anchor links...');
      // Extract new links on the page to find further page categories
      const pageLinks = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('a'))
          .map((a) => a.href)
          .filter((href) => href.startsWith('http'));
      });
      console.log(`      ✓ Discovered ${pageLinks.length} total anchor links.`);

      // Add discovered links to queue
      let queuedForActiveCategories = 0;
      let queuedForCompletedCategories = 0;

      for (const link of pageLinks) {
        const resolvedCat = classifyUrl(link);
        if (resolvedCat && !visitedUrls.has(link)) {
          const catCount = categoryCounts.get(resolvedCat) || 0;
          if (catCount < 2) {
            urlQueue.unshift(link); // Prioritize needed category screenshots
            queuedForActiveCategories++;
          } else {
            urlQueue.push(link);
            queuedForCompletedCategories++;
          }
        }
      }
      console.log(
        `      ✓ Queue updated: Prioritized +${queuedForActiveCategories} URLs, normal queued +${queuedForCompletedCategories} URLs.`,
      );
    } catch (err) {
      console.error(
        `      ✗ Error during page action: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  console.log('[DEBUG] Closing browser and cleaning up sessions...');
  await browser.close();
  console.log('[DEBUG] Browser session successfully closed!');

  console.log('\n============================================================');
  console.log('✨ Crawl and screen capture process completed successfully!');
  console.log('Categories captured:');
  for (const [cat, count] of categoryCounts.entries()) {
    console.log(` - ${cat}: ${count}/2 screenshots`);
  }
  console.log('============================================================\n');
}

run();
