import type { KeyEvent } from '@opentui/core';
import { getErrorMessage } from '../../core/errors.js';
import type { DbRow } from '../../core/types.js';
import { ansiToStyledText, formatTable } from '../../shared/utils/formatters.js';
import type { BbrViewController } from './bbrView.js';
import type { PlayerAwardRow } from './queries.js';
import {
  loadCareerStats,
  loadPlayerAwards,
  loadPlayerMeta,
  searchPlayerSuggestions,
} from './queries.js';
import type { PlayerSuggestion, TimeMachineHost } from './types.js';
import { formatAwardSeasonLines, groupPlayerAwards } from './utils/awards.js';
import {
  formatCareerEndYear,
  formatPlayerStatusLabel,
  isPlayerActive,
} from './utils/playerStatus.js';

export class PlayerModeController {
  constructor(
    private readonly host: TimeMachineHost,
    private readonly bbr: BbrViewController,
  ) {}

  async searchPlayers(): Promise<void> {
    const q = this.host.searchQuery.trim();
    if (q.length < 2) {
      this.host.suggestions = [];
      this.host.selectedSuggestIdx = 0;
      this.host.suggestionsText.content = ansiToStyledText('\nType 2+ characters to search');
      this.host.requestRender();
      return;
    }

    try {
      this.host.suggestions = await searchPlayerSuggestions(q);
      this.host.selectedSuggestIdx = 0;
      this.renderSuggestions();
    } catch (e: unknown) {
      this.host.suggestionsText.content = ansiToStyledText(`\nError: ${getErrorMessage(e)}`);
      this.host.requestRender();
    }
  }

  renderSuggestions(): void {
    if (this.host.suggestions.length === 0) {
      this.host.suggestionsText.content = ansiToStyledText('\nNo matching players found.');
      this.host.requestRender();
      return;
    }

    const lines = this.host.suggestions.map((p, idx) => {
      const isSelected = idx === this.host.selectedSuggestIdx;
      const prefix = isSelected ? ' \x1b[1;35m▶\x1b[0m ' : '   ';
      const status = isPlayerActive(p as unknown as DbRow) ? '\x1b[32mActive\x1b[0m' : 'Retired';
      const endYear = p.to_year === null || p.to_year === undefined ? 'Present' : p.to_year;
      const seasons = `(${p.from_year}-${endYear})`;
      const name = isSelected ? `\x1b[1m${p.full_name}\x1b[0m` : p.full_name;
      return `${prefix}${name} ${seasons} - ${status}`;
    });

    this.host.suggestionsText.content = ansiToStyledText(`\n${lines.join('\n')}`);
    this.host.requestRender();
  }

  async selectHighlightedSuggestion(): Promise<void> {
    const selected = this.host.suggestions[this.host.selectedSuggestIdx];
    if (selected) {
      this.host.searchInput.value = '';
      this.host.searchQuery = '';
      this.host.suggestions = [];
      this.host.suggestionsText.content = ansiToStyledText(
        '\nSearch completed. Type to search again.',
      );
      this.host.searchInput.blur();
      this.host.focusIndex = 1;
      this.host.focus();
      await this.loadPlayerDetails(selected);
    }
  }

  async loadPlayerDetails(player: PlayerSuggestion): Promise<void> {
    this.host.activePlayer = player;
    this.host.dossierText.content = ansiToStyledText('Loading dossier...');
    this.host.statsText.content = ansiToStyledText('Loading career stats...');
    this.host.requestRender();

    try {
      const meta: DbRow = (await loadPlayerMeta(player.player_id)) ?? { ...player };
      const awards = await loadPlayerAwards(player.player_id);
      this.host.careerStats = await loadCareerStats(player.player_id);

      this.host.activePlayerMeta = meta;
      this.host.activePlayerAwards = awards;
      this.host.activeSubpage = 'profile';
      this.host.selectedYearIdx = 0;
      this.host.statsPanel.title = 'Career Statistics';

      if (meta.bref_player_id) {
        try {
          const { fetchBbrPage } = await import('./utils/bbr/bbrScraper.js');
          const { parseBbrPlayerSublinks } = await import('./utils/bbr/bbrParser.js');
          const profileContent = await fetchBbrPage(String(meta.bref_player_id), 'profile');
          this.host.playerSublinks = parseBbrPlayerSublinks(profileContent);
        } catch {
          this.host.playerSublinks = null;
        }
      } else {
        this.host.playerSublinks = null;
      }

      this.renderDossier(meta, awards);
      this.renderStats();
    } catch (e: unknown) {
      this.host.dossierText.content = ansiToStyledText(
        `Error loading details:\n${getErrorMessage(e)}`,
      );
      this.host.statsText.content = ansiToStyledText('');
      this.host.requestRender();
    }
  }

  renderDossier(meta: DbRow, awards: PlayerAwardRow[]): void {
    const fullName = String(meta.full_name ?? 'Unknown');
    const heightInches = Number(meta.height_inches ?? 0);
    const feet = Math.floor(heightInches / 12);
    const inches = heightInches % 12;
    const heightStr = heightInches ? `${feet}'${inches}"` : 'Unknown';
    const weightStr = meta.body_weight_lbs ? `${meta.body_weight_lbs} lbs` : 'Unknown';

    let draftStr = 'Undrafted';
    if (meta.draft_year) {
      draftStr = `${meta.draft_year} - Rd ${meta.draft_round}, Pick ${meta.draft_number}`;
    }

    let dossier = `\x1b[1;35m${fullName}\x1b[0m\n`;
    dossier += `${`═`.repeat(fullName.length)}\n`;
    const statusLabel = formatPlayerStatusLabel(meta);
    const statusAnsi = statusLabel === 'Active' ? '\x1b[32mActive\x1b[0m' : 'Retired';
    dossier += `• \x1b[1mCareer Span:\x1b[0m ${meta.from_year} - ${formatCareerEndYear(meta)} (${statusAnsi})\n`;
    dossier += `• \x1b[1mPhysicals:\x1b[0m   ${heightStr} | ${weightStr}\n`;
    dossier += `• \x1b[1mBirth Date:\x1b[0m  ${meta.birth_date || 'Unknown'}\n`;
    dossier += `• \x1b[1mBackground:\x1b[0m  ${meta.country || 'USA'} | ${meta.school || 'High School'}\n`;
    dossier += `• \x1b[1mDraft Card:\x1b[0m  ${draftStr}\n`;

    if (awards.length > 0) {
      dossier += `\n\x1b[1;33mKey Career Accolades:\x1b[0m\n`;
      const grouped = groupPlayerAwards(awards);
      for (const entry of grouped) {
        const n = entry.seasons.length;
        dossier += ` * \x1b[1m${entry.label}\x1b[0m (${n}x):\n`;
        for (const line of formatAwardSeasonLines(entry.seasons)) {
          dossier += `   ${line}\n`;
        }
      }
    }

    dossier = this.bbr.appendDossierBbrHints(dossier);
    this.host.dossierText.content = ansiToStyledText(dossier);
    this.host.requestRender();
  }

  renderStats(): void {
    if (this.host.careerStats.length === 0) {
      this.host.statsText.content = ansiToStyledText(
        'No career statistics recorded for this player.',
      );
      this.host.requestRender();
      return;
    }

    const headers = [
      'Season',
      'Type',
      'GP',
      'GS',
      'MIN',
      'PTS',
      'AST',
      'REB',
      'STL',
      'BLK',
      'TS%',
      'PER',
      'BPM',
      'VORP',
    ];
    const keys = [
      'season_year',
      'playoff_str',
      'gp',
      'gs',
      'min',
      'pts',
      'ast',
      'reb',
      'stl',
      'blk',
      'ts_pct_str',
      'per',
      'bpm',
      'vorp',
    ];

    const formattedRows = this.host.careerStats.map((stat) => {
      return {
        ...stat,
        playoff_str: stat.is_playoffs ? 'Playoffs' : 'Reg Season',
        ts_pct_str: stat.ts_pct ? `${(stat.ts_pct * 100).toFixed(1)}%` : '.000',
        per: stat.per ? stat.per.toFixed(1) : '---',
        bpm: stat.bpm ? stat.bpm.toFixed(1) : '---',
        vorp: stat.vorp ? stat.vorp.toFixed(1) : '---',
      };
    });

    const lines = formatTable(headers, formattedRows, { colKeys: keys });

    const regSeasonStats = this.host.careerStats.filter((s) => !s.is_playoffs);
    let summary = '';
    if (regSeasonStats.length > 0) {
      let totalGp = 0;
      let totalGs = 0;
      let totalMin = 0;
      let totalPts = 0;
      let totalAst = 0;
      let totalReb = 0;
      let totalStl = 0;
      let totalBlk = 0;
      let hasStl = false;
      let hasBlk = false;
      let hasGs = false;

      let tsSum = 0;
      let tsCount = 0;

      for (const stat of regSeasonStats) {
        const gp = Number(stat.gp || 0);
        totalGp += gp;

        if (stat.gs !== null && stat.gs !== undefined) {
          totalGs += Number(stat.gs);
          hasGs = true;
        }
        totalMin += Number(stat.min || 0);
        totalPts += Number(stat.pts || 0);
        totalAst += Number(stat.ast || 0);
        if (stat.reb !== null && stat.reb !== undefined) {
          totalReb += Number(stat.reb);
        }
        if (stat.stl !== null && stat.stl !== undefined) {
          totalStl += Number(stat.stl);
          hasStl = true;
        }
        if (stat.blk !== null && stat.blk !== undefined) {
          totalBlk += Number(stat.blk);
          hasBlk = true;
        }
        if (stat.ts_pct !== null && stat.ts_pct !== undefined) {
          tsSum += Number(stat.ts_pct);
          tsCount++;
        }
      }

      const avgMin = totalGp > 0 ? (totalMin / totalGp).toFixed(1) : '---';
      const avgPts = totalGp > 0 ? (totalPts / totalGp).toFixed(1) : '---';
      const avgAst = totalGp > 0 ? (totalAst / totalGp).toFixed(1) : '---';
      const avgReb = totalGp > 0 ? (totalReb / totalGp).toFixed(1) : '---';
      const avgStl = totalGp > 0 && hasStl ? (totalStl / totalGp).toFixed(1) : '---';
      const avgBlk = totalGp > 0 && hasBlk ? (totalBlk / totalGp).toFixed(1) : '---';
      const avgTs = tsCount > 0 ? `${((tsSum / tsCount) * 100).toFixed(1)}%` : '---';

      summary += '\n\x1b[1;33mRegular Season Career Totals & Averages:\x1b[0m\n';
      summary += `• \x1b[1mTotals:\x1b[0m   GP: ${totalGp} | GS: ${hasGs ? totalGs : '---'} | MIN: ${totalMin} | PTS: ${totalPts} | AST: ${totalAst} | REB: ${totalReb} | STL: ${hasStl ? totalStl : '---'} | BLK: ${hasBlk ? totalBlk : '---'}\n`;
      summary += `• \x1b[1mAverages:\x1b[0m MPG: ${avgMin} | PPG: ${avgPts} | APG: ${avgAst} | RPG: ${avgReb} | SPG: ${avgStl} | BPG: ${avgBlk} | TS%: ${avgTs}\n`;
    }

    const playoffStats = this.host.careerStats.filter((s) => s.is_playoffs);
    if (playoffStats.length > 0) {
      let pTotalGp = 0;
      let pTotalGs = 0;
      let pTotalMin = 0;
      let pTotalPts = 0;
      let pTotalAst = 0;
      let pTotalReb = 0;
      let pTotalStl = 0;
      let pTotalBlk = 0;
      let pHasStl = false;
      let pHasBlk = false;
      let pHasGs = false;

      let pTsSum = 0;
      let pTsCount = 0;

      for (const stat of playoffStats) {
        const gp = Number(stat.gp || 0);
        pTotalGp += gp;

        if (stat.gs !== null && stat.gs !== undefined) {
          pTotalGs += Number(stat.gs);
          pHasGs = true;
        }
        pTotalMin += Number(stat.min || 0);
        pTotalPts += Number(stat.pts || 0);
        pTotalAst += Number(stat.ast || 0);
        if (stat.reb !== null && stat.reb !== undefined) {
          pTotalReb += Number(stat.reb);
        }
        if (stat.stl !== null && stat.stl !== undefined) {
          pTotalStl += Number(stat.stl);
          pHasStl = true;
        }
        if (stat.blk !== null && stat.blk !== undefined) {
          pTotalBlk += Number(stat.blk);
          pHasBlk = true;
        }
        if (stat.ts_pct !== null && stat.ts_pct !== undefined) {
          pTsSum += Number(stat.ts_pct);
          pTsCount++;
        }
      }

      const pAvgMin = pTotalGp > 0 ? (pTotalMin / pTotalGp).toFixed(1) : '---';
      const pAvgPts = pTotalGp > 0 ? (pTotalPts / pTotalGp).toFixed(1) : '---';
      const pAvgAst = pTotalGp > 0 ? (pTotalAst / pTotalGp).toFixed(1) : '---';
      const pAvgReb = pTotalGp > 0 ? (pTotalReb / pTotalGp).toFixed(1) : '---';
      const pAvgStl = pTotalGp > 0 && pHasStl ? (pTotalStl / pTotalGp).toFixed(1) : '---';
      const pAvgBlk = pTotalGp > 0 && pHasBlk ? (pTotalBlk / pTotalGp).toFixed(1) : '---';
      const pAvgTs = pTsCount > 0 ? `${((pTsSum / pTsCount) * 100).toFixed(1)}%` : '---';

      summary += `\n\x1b[1;35mPlayoffs Career Totals & Averages:\x1b[0m\n`;
      summary += `• \x1b[1mTotals:\x1b[0m   GP: ${pTotalGp} | GS: ${pHasGs ? pTotalGs : '---'} | MIN: ${pTotalMin} | PTS: ${pTotalPts} | AST: ${pTotalAst} | REB: ${pTotalReb} | STL: ${pHasStl ? pTotalStl : '---'} | BLK: ${pHasBlk ? pTotalBlk : '---'}\n`;
      summary += `• \x1b[1mAverages:\x1b[0m MPG: ${pAvgMin} | PPG: ${pAvgPts} | APG: ${pAvgAst} | RPG: ${pAvgReb} | SPG: ${pAvgStl} | BPG: ${pAvgBlk} | TS%: ${pAvgTs}\n`;
    }

    this.host.statsText.content = ansiToStyledText(`${lines.join('\n')}\n${summary}`);
    this.host.requestRender();
  }

  handleKeyPress(event: KeyEvent): boolean {
    if (this.host.focusIndex === 0) {
      if (event.name === 'up') {
        if (this.host.selectedSuggestIdx > 0) {
          this.host.selectedSuggestIdx--;
          this.renderSuggestions();
        }
        return true;
      }
      if (event.name === 'down') {
        if (this.host.selectedSuggestIdx < this.host.suggestions.length - 1) {
          this.host.selectedSuggestIdx++;
          this.renderSuggestions();
        }
        return true;
      }
      if (event.name === 'return' || event.name === 'enter') {
        void this.selectHighlightedSuggestion();
        return true;
      }
    } else if (this.host.focusIndex === 1) {
      if (this.host.activeSubpage === 'site') {
        if (event.name === 'up' && this.host.selectedSiteSectionIdx > 0) {
          this.host.selectedSiteSectionIdx--;
          this.host.selectedSitePageIdx = 0;
          this.bbr.renderSiteCatalog();
          if (this.host.activePlayerMeta) {
            this.renderDossier(this.host.activePlayerMeta, this.host.activePlayerAwards);
          }
          return true;
        }
        if (
          event.name === 'down' &&
          this.host.selectedSiteSectionIdx < this.host.siteCatalog.length - 1
        ) {
          this.host.selectedSiteSectionIdx++;
          this.host.selectedSitePageIdx = 0;
          this.bbr.renderSiteCatalog();
          if (this.host.activePlayerMeta) {
            this.renderDossier(this.host.activePlayerMeta, this.host.activePlayerAwards);
          }
          return true;
        }
        const sectionPages = this.bbr.getActiveSiteSectionPages();
        const key = (event.sequence || event.name || '').toLowerCase();
        if ((event.name === 'left' || key === '[') && this.host.selectedSitePageIdx > 0) {
          this.host.selectedSitePageIdx--;
          this.bbr.renderSiteCatalog();
          if (this.host.activePlayerMeta) {
            this.renderDossier(this.host.activePlayerMeta, this.host.activePlayerAwards);
          }
          return true;
        }
        if (
          (event.name === 'right' || key === ']') &&
          this.host.selectedSitePageIdx < sectionPages.length - 1
        ) {
          this.host.selectedSitePageIdx++;
          this.bbr.renderSiteCatalog();
          if (this.host.activePlayerMeta) {
            this.renderDossier(this.host.activePlayerMeta, this.host.activePlayerAwards);
          }
          return true;
        }
        if (event.name === 'return' || event.name === 'enter') {
          const page = sectionPages[this.host.selectedSitePageIdx];
          if (page) {
            void this.bbr.loadMirroredRelativePath(page.relativePath);
          }
          return true;
        }
      }

      const count = this.bbr.getAvailableSubpageYearsCount();
      if (
        count > 0 &&
        this.host.activeSubpage !== 'site' &&
        (event.name === 'up' || event.name === 'down')
      ) {
        if (event.name === 'up') {
          if (this.host.selectedYearIdx > 0) {
            this.host.selectedYearIdx--;
            void this.bbr.loadBbrSubpage(this.host.activeSubpage);
          }
        } else if (this.host.selectedYearIdx < count - 1) {
          this.host.selectedYearIdx++;
          void this.bbr.loadBbrSubpage(this.host.activeSubpage);
        }
        return true;
      }
      return this.host.dossierScroll.handleKeyPress(event);
    } else if (this.host.focusIndex === 2) {
      return this.host.statsScroll.handleKeyPress(event);
    }
    return false;
  }
}
