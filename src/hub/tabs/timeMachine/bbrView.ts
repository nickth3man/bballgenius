import { getErrorMessage } from '../../core/errors.js';
import { ansiToStyledText, formatTable } from '../../shared/utils/formatters.js';
import type { TimeMachineHost } from './types.js';
import { depthStepLabel, getDepthChain, orderSectionPages } from './utils/bbr/bbrDepthCatalog.js';
import type { BbrMirroredPage } from './utils/bbr/bbrMirroredStore.js';
import type { BbrPageData } from './utils/bbr/bbrParser.js';
import {
  BBR_PLAYER_SUBPAGES,
  BBR_SITE_PAGES,
  type BbrPlayerPageType,
  buildSiteCatalog,
  getPlayerSubpageByKey,
  getSitePageByKey,
} from './utils/bbr/bbrSiteCatalog.js';

export class BbrViewController {
  constructor(private readonly host: TimeMachineHost) {}

  handlePlayerBbrKeys(key: string): boolean {
    if (!this.host.activePlayerMeta?.bref_player_id) {
      return false;
    }

    const playerSub = getPlayerSubpageByKey(key);
    if (playerSub) {
      if (playerSub.id === 'profile') {
        this.host.activeSubpage = 'profile';
        this.host.statsPanel.title = 'Career Statistics';
        return true;
      }
      this.host.activeSubpage = playerSub.id;
      void this.loadBbrSubpage(playerSub.id);
      return true;
    }

    if (key === 'm') {
      this.host.activeSubpage = 'site';
      this.host.siteCatalog = buildSiteCatalog();
      this.host.selectedSiteSectionIdx = 0;
      this.host.selectedSitePageIdx = 0;
      this.renderSiteCatalog();
      return true;
    }

    if (this.host.activeSubpage === 'site') {
      const sitePage = getSitePageByKey(key);
      if (sitePage) {
        void this.loadBbrSitePageDef(sitePage);
        return true;
      }
    }

    return false;
  }

  handleTeamBbrKeys(key: string): boolean {
    if (key === 'r') {
      this.host.activeTeamSubpage = 'comparison';
      return true;
    }
    if (key === 'i') {
      this.host.activeTeamSubpage = 'teams_index';
      void this.loadBbrTeamSubpage('teams_index');
      return true;
    }
    if (key === 'f') {
      this.host.activeTeamSubpage = 'team_a_profile';
      void this.loadBbrTeamSubpage('team_a_profile');
      return true;
    }
    if (key === 'g') {
      this.host.activeTeamSubpage = 'team_b_profile';
      void this.loadBbrTeamSubpage('team_b_profile');
      return true;
    }
    if (key === 'l') {
      this.host.activeTeamSubpage = 'leaders_index';
      void this.loadBbrTeamSubpage('leaders_index');
      return true;
    }
    if (key === 'e') {
      this.host.activeTeamSubpage = 'leagues_index';
      void this.loadBbrTeamSubpage('leagues_index');
      return true;
    }
    if (key === 's') {
      this.host.activeTeamSubpage = 'team_season';
      void this.loadBbrTeamSubpage('team_season');
      return true;
    }
    if (key === 'a') {
      this.host.activeTeamSubpage = 'team_adv_gamelog';
      void this.loadBbrTeamSubpage('team_adv_gamelog');
      return true;
    }
    if (['t', 'u', 'y', 'w', 'v', 'x', 'z'].includes(key)) {
      const pageMap: Record<
        string,
        | 'contracts'
        | 'season_summary'
        | 'playoffs'
        | 'awards'
        | 'game_boxscore'
        | 'game_shot_chart'
        | 'game_pbp'
      > = {
        t: 'contracts',
        u: 'season_summary',
        y: 'playoffs',
        w: 'awards',
        v: 'game_boxscore',
        x: 'game_shot_chart',
        z: 'game_pbp',
      };
      const pageType = pageMap[key];
      this.host.activeTeamSubpage = pageType;
      void this.loadBbrTeamSubpage(pageType);
      return true;
    }
    return false;
  }

  getActiveBbrSubpageLink(): { label: string; year: string } | null {
    if (!this.host.playerSublinks || !this.host.activePlayerMeta?.bref_player_id) {
      return null;
    }
    const cat = this.host.activeSubpage;
    if (cat === 'site' || cat === 'profile') {
      return null;
    }
    const links = this.host.playerSublinks[cat];
    if (links && links.length > 0) {
      return links[this.host.selectedYearIdx] || links[0] || null;
    }
    return null;
  }

  getAvailableSubpageYearsCount(): number {
    if (!this.host.playerSublinks) return 0;
    const cat = this.host.activeSubpage;
    if (cat === 'site' || cat === 'profile') {
      return 0;
    }
    const def = BBR_PLAYER_SUBPAGES.find((p) => p.id === cat);
    if (!def?.yearNav) {
      return 0;
    }
    return this.host.playerSublinks[cat]?.length || 0;
  }

  getActiveSiteSection(): ReturnType<typeof buildSiteCatalog>[number] | null {
    return this.host.siteCatalog[this.host.selectedSiteSectionIdx] ?? null;
  }

  getActiveSiteSectionPages(): BbrMirroredPage[] {
    const section = this.getActiveSiteSection();
    if (!section) {
      return [];
    }
    return orderSectionPages(section.id, section.pages);
  }

  renderSiteCatalog(): void {
    this.host.statsPanel.title = 'Basketball-Reference Site Index';
    let output = '\x1b[1;35mBasketball-Reference Site Sections\x1b[0m\n';
    output += `${'═'.repeat(36)}\n\n`;
    output += '\x1b[90m↑↓ section · ←→ page · Enter load · [M] shortcuts below\x1b[0m\n\n';

    for (const page of BBR_SITE_PAGES) {
      output += ` \x1b[1m[${page.key}]\x1b[0m ${page.label}\n`;
    }

    output += `\n\x1b[1;33mMirrored sections (${this.host.siteCatalog.length}):\x1b[0m\n`;
    for (let idx = 0; idx < this.host.siteCatalog.length; idx++) {
      const section = this.host.siteCatalog[idx];
      const prefix = idx === this.host.selectedSiteSectionIdx ? '\x1b[1;36m▶\x1b[0m' : ' ';
      const depthChain = getDepthChain(section.id);
      const depthHint =
        depthChain.length > 0 ? ` · depth ${depthChain.map((pick) => pick.depth).join('→')}` : '';
      output += `${prefix} ${section.label} (${section.pages.length} pages${depthHint})\n`;
    }

    const activeSection = this.getActiveSiteSection();
    const sectionPages = this.getActiveSiteSectionPages();
    if (activeSection && sectionPages.length > 0) {
      output += `\n\x1b[1;33m${activeSection.label} pages:\x1b[0m\n`;
      const depthByPath = new Map(
        getDepthChain(activeSection.id).map((pick) => [pick.relativePath, pick.depth]),
      );
      for (let idx = 0; idx < sectionPages.length; idx++) {
        const page = sectionPages[idx];
        const depth = depthByPath.get(page.relativePath);
        const depthTag = depth !== undefined ? `\x1b[90md${depth}\x1b[0m ` : '';
        const prefix = idx === this.host.selectedSitePageIdx ? '\x1b[1;36m▶\x1b[0m' : ' ';
        output += `${prefix} ${depthTag}${page.label}\n`;
      }
    }

    this.host.statsText.content = ansiToStyledText(output);
    this.host.requestRender();
  }

  appendDossierBbrHints(dossier: string): string {
    if (!this.host.activePlayerMeta?.bref_player_id) {
      return dossier;
    }

    dossier += '\n\x1b[1;33mPlayer sub-pages (press key anywhere):\x1b[0m\n';
    const subpageIndicator = (sub: string, subKey: string, label: string) => {
      return this.host.activeSubpage === sub
        ? `\x1b[1;36m[${subKey}] ${label}\x1b[0m`
        : `\x1b[1m[${subKey}]\x1b[0m ${label}`;
    };

    const row1 = BBR_PLAYER_SUBPAGES.slice(0, 5)
      .map((p) => subpageIndicator(p.id, p.key, p.label))
      .join(' · ');
    const row2 = BBR_PLAYER_SUBPAGES.slice(5)
      .map((p) => subpageIndicator(p.id, p.key, p.label))
      .join(' · ');
    dossier += ` ${row1}\n ${row2}\n`;
    dossier += ` ${subpageIndicator('site', 'M', 'BBR Site Index')}\n`;

    const yearLink = this.getActiveBbrSubpageLink();
    if (yearLink) {
      dossier += `\n\x1b[90mSeason/year (↑↓ in dossier): ${yearLink.label}\x1b[0m\n`;
    }

    if (this.host.activeSubpage === 'site') {
      dossier += '\n\x1b[1;33mSite sections (↑↓) · pages (←→ · Enter):\x1b[0m\n';
      for (let idx = 0; idx < this.host.siteCatalog.length; idx++) {
        const section = this.host.siteCatalog[idx];
        const prefix = idx === this.host.selectedSiteSectionIdx ? '\x1b[1;36m▶\x1b[0m' : ' ';
        dossier += `${prefix} ${section.label}\n`;
      }
      const sectionPages = this.getActiveSiteSectionPages();
      if (sectionPages.length > 0) {
        dossier += '\n\x1b[90mDepth chain:\x1b[0m\n';
        for (const pick of getDepthChain(this.getActiveSiteSection()?.id ?? '')) {
          dossier += ` · ${depthStepLabel(pick)}\n`;
        }
        const page = sectionPages[this.host.selectedSitePageIdx];
        if (page) {
          dossier += `\n\x1b[90mSelected:\x1b[0m ${page.relativePath}\n`;
        }
      }
    }

    return dossier;
  }

  async loadBbrSubpage(type: BbrPlayerPageType): Promise<void> {
    if (!this.host.activePlayerMeta?.bref_player_id) {
      this.host.statsText.content = ansiToStyledText(
        'No Basketball-Reference ID available for this player.',
      );
      this.host.requestRender();
      return;
    }

    const brefId = String(this.host.activePlayerMeta.bref_player_id);
    this.host.statsText.content = ansiToStyledText(`Fetching Basketball-Reference ${type}...`);
    this.host.requestRender();

    try {
      const { fetchBbrPage } = await import('./utils/bbr/bbrScraper.js');
      const { parseBbrMarkdown } = await import('./utils/bbr/bbrParser.js');

      let year = '2024';
      const link = this.getActiveBbrSubpageLink();
      if (link?.year) {
        year = link.year;
      }

      const content = await fetchBbrPage(brefId, type, year);
      const parsed = parseBbrMarkdown(content);
      this.renderBbrPageData(parsed, type);
    } catch (e: unknown) {
      this.host.statsText.content = ansiToStyledText(
        `Error loading Basketball-Reference ${type}:\n${getErrorMessage(e)}`,
      );
      this.host.requestRender();
    }
  }

  async loadBbrSitePageDef(pageDef: (typeof BBR_SITE_PAGES)[number]): Promise<void> {
    this.host.statsText.content = ansiToStyledText(`Fetching ${pageDef.label}...`);
    this.host.requestRender();

    try {
      const { fetchBbrSitePage } = await import('./utils/bbr/bbrScraper.js');
      const { parseBbrMarkdown } = await import('./utils/bbr/bbrParser.js');

      const content = await fetchBbrSitePage(
        pageDef.id,
        pageDef.defaultParam,
        pageDef.mirroredPath,
      );
      const parsed = parseBbrMarkdown(content);
      this.renderBbrPageData(parsed, pageDef.label);
    } catch (e: unknown) {
      this.host.statsText.content = ansiToStyledText(
        `Error loading ${pageDef.label}:\n${getErrorMessage(e)}`,
      );
      this.host.requestRender();
    }
  }

  async loadMirroredRelativePath(relativePath: string): Promise<void> {
    this.host.statsText.content = ansiToStyledText(`Loading ${relativePath}...`);
    this.host.requestRender();

    try {
      const { fetchMirroredPage } = await import('./utils/bbr/bbrScraper.js');
      const { parseBbrMarkdown } = await import('./utils/bbr/bbrParser.js');
      const content = fetchMirroredPage(relativePath);
      const parsed = parseBbrMarkdown(content);
      this.renderBbrPageData(parsed, relativePath);
    } catch (e: unknown) {
      this.host.statsText.content = ansiToStyledText(
        `Error loading ${relativePath}:\n${getErrorMessage(e)}`,
      );
      this.host.requestRender();
    }
  }

  async loadBbrTeamSubpage(
    type:
      | 'contracts'
      | 'season_summary'
      | 'playoffs'
      | 'awards'
      | 'leaders_index'
      | 'leagues_index'
      | 'team_season'
      | 'team_adv_gamelog'
      | 'game_boxscore'
      | 'game_shot_chart'
      | 'game_pbp'
      | 'teams_index'
      | 'team_a_profile'
      | 'team_b_profile',
  ): Promise<void> {
    this.host.statsText.content = ansiToStyledText(
      `Fetching Basketball-Reference team subpage ${type}...`,
    );
    this.host.requestRender();

    try {
      const { fetchBbrGeneralPage, fetchBbrTeamPage, fetchMirroredPage } = await import(
        './utils/bbr/bbrScraper.js'
      );
      const { parseBbrMarkdown } = await import('./utils/bbr/bbrParser.js');

      let content = '';
      if (type === 'contracts') {
        content = await fetchBbrGeneralPage('contracts', 'CLE');
      } else if (type === 'season_summary') {
        content = await fetchBbrGeneralPage('season_summary', '2024');
      } else if (type === 'playoffs') {
        content = await fetchBbrGeneralPage('playoffs', '2024');
      } else if (type === 'awards') {
        content = fetchMirroredPage('awards/index.html');
      } else if (type === 'leaders_index') {
        content = fetchMirroredPage('leaders/index.html');
      } else if (type === 'leagues_index') {
        content = fetchMirroredPage('leagues/index.html');
      } else if (type === 'team_season') {
        content = fetchMirroredPage('teams/ATL/2000.html');
      } else if (type === 'team_adv_gamelog') {
        content = fetchMirroredPage('teams/CHI/2026/gamelog-advanced/index.html');
      } else if (type === 'game_boxscore') {
        content = await fetchBbrGeneralPage('game_boxscore', '202406060BOS');
      } else if (type === 'game_shot_chart') {
        content = await fetchBbrGeneralPage('game_shot_chart', '202406060BOS');
      } else if (type === 'game_pbp') {
        content = await fetchBbrGeneralPage('game_pbp', '202406060BOS');
      } else if (type === 'teams_index') {
        content = fetchMirroredPage('teams/index.html');
      } else if (type === 'team_a_profile') {
        const abbrev = this.host.teamAData?.team_abbrev ?? 'LAL';
        content = await fetchBbrTeamPage(abbrev);
      } else if (type === 'team_b_profile') {
        const abbrev = this.host.teamBData?.team_abbrev ?? 'PHI';
        content = await fetchBbrTeamPage(abbrev);
      }

      const parsed = parseBbrMarkdown(content);
      this.renderBbrPageData(parsed, type);
    } catch (e: unknown) {
      this.host.statsText.content = ansiToStyledText(
        `Error loading team subpage ${type}:\n${getErrorMessage(e)}`,
      );
      this.host.requestRender();
    }
  }

  renderBbrPageData(parsed: BbrPageData, _type: string): void {
    let output = '';

    this.host.statsPanel.title = `Basketball-Reference - ${parsed.title}`;

    if (parsed.tables.length === 0) {
      output = `No tabular data parsed from this page. Content is displayed below:\n\n${parsed.subtitle || ''}`;
      this.host.statsText.content = ansiToStyledText(output);
      this.host.requestRender();
      return;
    }

    parsed.tables.forEach((table, tableIdx) => {
      output += `\n\x1b[1;33mTable [${tableIdx + 1}]: ${table.title}\x1b[0m\n`;
      output += `${'─'.repeat(table.title.length + 12)}\n`;

      const colKeys = table.headers;
      const lines = formatTable(table.headers, table.rows, { colKeys });
      output += `${lines.join('\n')}\n`;
    });

    this.host.statsText.content = ansiToStyledText(output);
    this.host.requestRender();
  }
}
