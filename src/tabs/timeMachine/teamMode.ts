import type { KeyEvent } from '@opentui/core';
import { getErrorMessage } from '../../core/errors.js';
import type { AppKeyEvent } from '../../core/input.js';
import { ansiToStyledText } from '../../shared/utils/formatters.js';
import { ansiBold, ansiCyan, ansiDim, ansiMagenta, ansiYellow } from '../../shared/utils/theme.js';
import type { TeamRosterRow } from './queries.js';
import { findTeam, loadTeamRoster, loadTeamSeasonStats } from './queries.js';
import type { TeamComparisonData, TimeMachineHost } from './types.js';
import { parseTeamQuery } from './utils/teamQuery.js';

export class TeamModeController {
  teamARoster: TeamRosterRow[] = [];
  teamBRoster: TeamRosterRow[] = [];

  constructor(private readonly host: TimeMachineHost) {}

  showPanels(): void {
    this.host.searchPanel.visible = false;
    this.host.dossierPanel.visible = false;
    this.host.teamSearchPanel.visible = true;
    this.host.teamFocusIndex = 0;
  }

  hidePanels(): void {
    this.host.searchPanel.visible = true;
    this.host.dossierPanel.visible = true;
    this.host.teamSearchPanel.visible = false;
  }

  ensureDefaultTeamsLoaded(): void {
    if (!this.host.teamAData && this.host.teamAQuery) {
      void this.loadTeamData('A');
    }
    if (!this.host.teamBData && this.host.teamBQuery) {
      void this.loadTeamData('B');
    }
  }

  async loadTeamData(type: 'A' | 'B'): Promise<void> {
    const inputStr = type === 'A' ? this.host.teamAQuery : this.host.teamBQuery;
    const parsed = parseTeamQuery(inputStr);
    if (!parsed) {
      if (type === 'A') {
        this.host.teamAData = null;
        this.teamARoster = [];
      } else {
        this.host.teamBData = null;
        this.teamBRoster = [];
      }
      this.renderTeamComparison();
      return;
    }

    try {
      const team = await findTeam(parsed.teamQuery);
      if (!team) {
        throw new Error(`Team "${parsed.teamQuery}" not found.`);
      }

      const stats = await loadTeamSeasonStats(team.team_id, parsed.year);
      const roster = await loadTeamRoster(team.team_id, parsed.year);

      const teamInfo: TeamComparisonData = {
        team_id: team.team_id,
        team_abbrev: team.team_abbrev,
        team_name: team.team_name,
        year: parsed.year,
        gp: stats?.gp ?? 0,
        ppg: stats?.ppg ?? 0,
        apg: stats?.apg ?? 0,
        rpg: stats?.rpg ?? 0,
        spg: stats?.spg ?? 0,
        bpg: stats?.bpg ?? 0,
      };

      if (type === 'A') {
        this.host.teamAData = teamInfo;
        this.teamARoster = roster;
      } else {
        this.host.teamBData = teamInfo;
        this.teamBRoster = roster;
      }

      this.renderTeamComparison();
    } catch (e: unknown) {
      const errorInfo: TeamComparisonData = {
        team_name: 'Error',
        team_abbrev: 'ERR',
        year: parsed.year,
        gp: 0,
        ppg: 0,
        apg: 0,
        rpg: 0,
        spg: 0,
        bpg: 0,
        errorMessage: getErrorMessage(e),
      };
      if (type === 'A') {
        this.host.teamAData = errorInfo;
        this.teamARoster = [];
      } else {
        this.host.teamBData = errorInfo;
        this.teamBRoster = [];
      }
      this.renderTeamComparison();
    }
  }

  renderTeamComparison(): void {
    if (this.host.mode !== 'team') return;

    const M = 16; // metric label width
    const C = 22; // per-team column width
    const rule = (ch: string) => ch.repeat(M + C + C + 6);

    let content = `${ansiBold(ansiCyan('HISTORICAL TEAM COMPARISON'))}\n`;
    content += `${rule('─')}\n`;

    const formatTeamHeader = (data: TeamComparisonData | null) => {
      if (!data) return 'No Team Loaded';
      if (data.errorMessage) return `Error: ${data.errorMessage}`;
      return `${data.team_abbrev} ${data.year} (${data.team_name})`;
    };

    const headerA = formatTeamHeader(this.host.teamAData);
    const headerB = formatTeamHeader(this.host.teamBData);

    const pad = (str: string, len: number) => {
      const s = String(str);
      if (s.length > len) return `${s.slice(0, len - 1)}…`;
      return s + ' '.repeat(Math.max(0, len - s.length));
    };

    content += `${pad('Metric', M)}│ ${ansiBold(ansiYellow(pad(headerA, C)))}│ ${ansiBold(ansiMagenta(pad(headerB, C)))}\n`;
    content += `${'─'.repeat(M)}┼${'─'.repeat(C + 1)}┼${'─'.repeat(C + 1)}\n`;

    const getVal = (
      data: TeamComparisonData | null,
      key: keyof TeamComparisonData,
      isFloat = true,
    ) => {
      if (!data || data.errorMessage) return '---';
      const val = data[key];
      if (val === undefined || val === null) return '---';
      return isFloat ? Number(val).toFixed(1) : String(val);
    };

    const metricRow = (label: string, key: keyof TeamComparisonData, isFloat = true) => {
      content += `${pad(label, M)}│ ${pad(getVal(this.host.teamAData, key, isFloat), C)}│ ${pad(getVal(this.host.teamBData, key, isFloat), C)}\n`;
    };

    metricRow('Games Played', 'gp', false);
    metricRow('Points / Game', 'ppg');
    metricRow('Assists / Game', 'apg');
    metricRow('Rebounds / Game', 'rpg');
    metricRow('Steals / Game', 'spg');
    metricRow('Blocks / Game', 'bpg');

    content += `\n${ansiBold(ansiCyan('ROSTER SIDE-BY-SIDE'))} ${ansiDim('(PPG / APG)')}\n`;
    content += `${rule('─')}\n`;

    const nameA =
      this.host.teamAData && !this.host.teamAData.errorMessage
        ? `${this.host.teamAData.team_abbrev} ${this.host.teamAData.year}`
        : 'Team A';
    const nameB =
      this.host.teamBData && !this.host.teamBData.errorMessage
        ? `${this.host.teamBData.team_abbrev} ${this.host.teamBData.year}`
        : 'Team B';

    const R = 32; // roster column width
    content += `${ansiBold(ansiYellow(pad(`${nameA} Roster`, R)))}│ ${ansiBold(ansiMagenta(pad(`${nameB} Roster`, R)))}\n`;
    content += `${'─'.repeat(R)}┼${'─'.repeat(R + 1)}\n`;

    const maxRosterLen = Math.max(this.teamARoster.length, this.teamBRoster.length);
    if (maxRosterLen === 0) {
      content += `${pad(' No roster data available.', R)}│  No roster data available.\n`;
    } else {
      const truncate = (str: string, len: number) => {
        if (str.length <= len) return str;
        return `${str.slice(0, len - 1)}…`;
      };

      for (let i = 0; i < maxRosterLen; i++) {
        const pA = this.teamARoster[i];
        const pB = this.teamBRoster[i];

        const nameA_trunc = pA ? truncate(pA.full_name, 20) : '';
        const nameB_trunc = pB ? truncate(pB.full_name, 20) : '';
        const statsA = pA ? `(${Number(pA.ppg).toFixed(1)}/${Number(pA.apg).toFixed(1)})` : '';
        const statsB = pB ? `(${Number(pB.ppg).toFixed(1)}/${Number(pB.apg).toFixed(1)})` : '';

        const strA = pA ? `${nameA_trunc} ${statsA}` : '';
        const strB = pB ? `${nameB_trunc} ${statsB}` : '';

        content += `${pad(strA, R)}│ ${pad(strB, R + 1)}\n`;
      }
    }

    this.host.statsText.content = ansiToStyledText(content);
    this.host.requestRender();
  }

  renderTeamInstructions(): void {
    let content = `\n${ansiDim('Instructions:')}\nType Team name/abbreviation with a 4-digit year. Press [Enter] to fetch stats. Use [Tab] to move, [C] to toggle.\n`;

    content += `\n${ansiBold(ansiYellow('Sub-pages (Press keys anywhere to load):'))}\n`;
    const subpageIndicator = (sub: string, key: string, label: string) => {
      return this.host.activeTeamSubpage === sub
        ? `${ansiBold(ansiCyan(`[${key}] ${label}`))}`
        : `${ansiBold(`[${key}]`)} ${label}`;
    };
    content += ` ${subpageIndicator('comparison', 'R', 'Reset')} · ${subpageIndicator('teams_index', 'I', 'Teams')} · ${subpageIndicator('team_a_profile', 'F', 'Team A Page')}\n`;
    content += ` ${subpageIndicator('team_b_profile', 'G', 'Team B Page')} · ${subpageIndicator('leaders_index', 'L', 'Leaders')} · ${subpageIndicator('leagues_index', 'E', 'Leagues')}\n`;
    content += ` ${subpageIndicator('contracts', 'T', 'Contracts')} · ${subpageIndicator('season_summary', 'U', 'Season')} · ${subpageIndicator('team_season', 'S', 'ATL 2000')}\n`;
    content += ` ${subpageIndicator('playoffs', 'Y', 'Playoffs')} · ${subpageIndicator('awards', 'W', 'Awards')} · ${subpageIndicator('team_adv_gamelog', 'A', 'CHI Adv Log')}\n`;
    content += ` ${subpageIndicator('game_boxscore', 'V', 'Boxscore')} · ${subpageIndicator('game_shot_chart', 'X', 'Shot Chart')} · ${subpageIndicator('game_pbp', 'Z', 'Play-by-Play')}\n`;

    this.host.teamInstructions.content = ansiToStyledText(content);
    this.host.requestRender();
  }

  handleKeyPress(event: AppKeyEvent): boolean {
    if (this.host.teamFocusIndex === 0) {
      if (event.name === 'return' || event.name === 'enter') {
        void this.loadTeamData('A');
        return true;
      }
    } else if (this.host.teamFocusIndex === 1) {
      if (event.name === 'return' || event.name === 'enter') {
        void this.loadTeamData('B');
        return true;
      }
    } else if (this.host.teamFocusIndex === 2) {
      return this.host.statsScroll.handleKeyPress(event as KeyEvent);
    }
    return false;
  }
}
