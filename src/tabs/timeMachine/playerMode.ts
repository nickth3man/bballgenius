import type { KeyEvent } from '@opentui/core';
import { getErrorMessage } from '../../core/errors.js';
import type { AppKeyEvent } from '../../core/input.js';
import type { DbRow } from '../../core/types.js';
import { ansiToStyledText, formatTable } from '../../shared/utils/formatters.js';
import { ansiBold, ansiGreen, ansiMagenta, ansiYellow } from '../../shared/utils/theme.js';
import type { BbrViewController } from './bbrView.js';
import type { CareerStatRow, PlayerAwardRow } from './queries.js';
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

interface ComputedStats {
  totalGp: number;
  totalGs: number;
  totalMin: number;
  totalPts: number;
  totalAst: number;
  totalReb: number;
  totalStl: number;
  totalBlk: number;
  hasStl: boolean;
  hasBlk: boolean;
  hasGs: boolean;
  tsSum: number;
  tsCount: number;
}

function computeStatTotals(stats: CareerStatRow[]): ComputedStats {
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

  for (const stat of stats) {
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

  return {
    totalGp,
    totalGs,
    totalMin,
    totalPts,
    totalAst,
    totalReb,
    totalStl,
    totalBlk,
    hasStl,
    hasBlk,
    hasGs,
    tsSum,
    tsCount,
  };
}

function formatStatSummary(s: ComputedStats, coloredHeader: string): string {
  const avgMin = s.totalGp > 0 ? (s.totalMin / s.totalGp).toFixed(1) : '---';
  const avgPts = s.totalGp > 0 ? (s.totalPts / s.totalGp).toFixed(1) : '---';
  const avgAst = s.totalGp > 0 ? (s.totalAst / s.totalGp).toFixed(1) : '---';
  const avgReb = s.totalGp > 0 ? (s.totalReb / s.totalGp).toFixed(1) : '---';
  const avgStl = s.totalGp > 0 && s.hasStl ? (s.totalStl / s.totalGp).toFixed(1) : '---';
  const avgBlk = s.totalGp > 0 && s.hasBlk ? (s.totalBlk / s.totalGp).toFixed(1) : '---';
  const avgTs = s.tsCount > 0 ? `${((s.tsSum / s.tsCount) * 100).toFixed(1)}%` : '---';

  let summary = `\n${coloredHeader}\n`;
  summary += `\u2022 ${ansiBold('Totals:')}   GP: ${s.totalGp} | GS: ${s.hasGs ? s.totalGs : '---'} | MIN: ${s.totalMin} | PTS: ${s.totalPts} | AST: ${s.totalAst} | REB: ${s.totalReb} | STL: ${s.hasStl ? s.totalStl : '---'} | BLK: ${s.hasBlk ? s.totalBlk : '---'}\n`;
  summary += `\u2022 ${ansiBold('Averages:')} MPG: ${avgMin} | PPG: ${avgPts} | APG: ${avgAst} | RPG: ${avgReb} | SPG: ${avgStl} | BPG: ${avgBlk} | TS%: ${avgTs}\n`;
  return summary;
}

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
      const prefix = isSelected ? ` ${ansiBold(ansiMagenta('▶'))} ` : '   ';
      const status = isPlayerActive(p as unknown as DbRow) ? ansiGreen('Active') : 'Retired';
      const endYear = p.to_year === null || p.to_year === undefined ? 'Present' : p.to_year;
      const seasons = `(${p.from_year}-${endYear})`;
      const name = isSelected ? ansiBold(p.full_name) : p.full_name;
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

    let dossier = `${ansiBold(ansiMagenta(fullName))}\n`;
    dossier += `${'═'.repeat(fullName.length)}\n`;
    const statusLabel = formatPlayerStatusLabel(meta);
    const statusAnsi = statusLabel === 'Active' ? ansiGreen('Active') : 'Retired';
    dossier += `\u2022 ${ansiBold('Career Span:')} ${meta.from_year} - ${formatCareerEndYear(meta)} (${statusAnsi})\n`;
    dossier += `\u2022 ${ansiBold('Physicals:')}   ${heightStr} | ${weightStr}\n`;
    dossier += `\u2022 ${ansiBold('Birth Date:')}  ${meta.birth_date || 'Unknown'}\n`;
    dossier += `\u2022 ${ansiBold('Background:')}  ${meta.country || 'USA'} | ${meta.school || 'High School'}\n`;
    dossier += `\u2022 ${ansiBold('Draft Card:')}  ${draftStr}\n`;

    if (awards.length > 0) {
      dossier += `\n${ansiBold(ansiYellow('Key Career Accolades:'))}\n`;
      const grouped = groupPlayerAwards(awards);
      for (const entry of grouped) {
        const n = entry.seasons.length;
        dossier += ` * ${ansiBold(entry.label)} (${n}x):\n`;
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
      summary += formatStatSummary(
        computeStatTotals(regSeasonStats),
        ansiBold(ansiYellow('Regular Season Career Totals & Averages:')),
      );
    }

    const playoffStats = this.host.careerStats.filter((s) => s.is_playoffs);
    if (playoffStats.length > 0) {
      summary += formatStatSummary(
        computeStatTotals(playoffStats),
        ansiBold(ansiMagenta('Playoffs Career Totals & Averages:')),
      );
    }

    this.host.statsText.content = ansiToStyledText(`${lines.join('\n')}\n${summary}`);
    this.host.requestRender();
  }

  handleKeyPress(event: AppKeyEvent): boolean {
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
      return this.host.dossierScroll.handleKeyPress(event as KeyEvent);
    } else if (this.host.focusIndex === 2) {
      return this.host.statsScroll.handleKeyPress(event as KeyEvent);
    }
    return false;
  }
}
