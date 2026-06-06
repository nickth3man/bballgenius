import type { PlayerPerGameRow } from 'data/tabs/time-machine/queries';
import { useMemo } from 'react';

import type { CareerSummaryRow } from '../internal/types.js';

export function useCareerSummary(rows: PlayerPerGameRow[]): CareerSummaryRow[] {
  return useMemo(() => {
    if (rows.length === 0) return [];
    const validRows = rows.filter((r) => r.g != null && Number(r.g) > 0);
    if (validRows.length === 0) return [];

    // Career totals (games-weighted)
    const totalG = validRows.reduce((sum, r) => sum + (Number(r.g) || 0), 0);
    const avg = (key: keyof PlayerPerGameRow): number => {
      const weighted = validRows.reduce(
        (sum, r) => sum + (Number(r[key]) || 0) * (Number(r.g) || 0),
        0,
      );
      return totalG > 0 ? weighted / totalG : 0;
    };
    const avgPct = (key: keyof PlayerPerGameRow): number => {
      // For pct columns, compute from totals
      const attemptsKey =
        key === 'fg_percent'
          ? 'fga_per_game'
          : key === 'x3p_percent'
            ? 'x3pa_per_game'
            : key === 'x2p_percent'
              ? 'x2pa_per_game'
              : key === 'ft_percent'
                ? 'fta_per_game'
                : null;
      const makesKey =
        key === 'fg_percent'
          ? 'fg_per_game'
          : key === 'x3p_percent'
            ? 'x3p_per_game'
            : key === 'x2p_percent'
              ? 'x2p_per_game'
              : key === 'ft_percent'
                ? 'ft_per_game'
                : null;
      if (!attemptsKey || !makesKey) return avg(key);
      const totalMakes = validRows.reduce(
        (sum, r) => sum + (Number(r[makesKey]) || 0) * (Number(r.g) || 0),
        0,
      );
      const totalAttempts = validRows.reduce(
        (sum, r) => sum + (Number(r[attemptsKey]) || 0) * (Number(r.g) || 0),
        0,
      );
      return totalAttempts > 0 ? totalMakes / totalAttempts : 0;
    };

    // Per-team summary
    const teamGroups = new Map<string, PlayerPerGameRow[]>();
    for (const r of validRows) {
      const tm = String(r.team ?? 'TOT');
      const existing = teamGroups.get(tm) ?? [];
      existing.push(r);
      teamGroups.set(tm, existing);
    }

    const summaries: CareerSummaryRow[] = [];

    // Career row
    const careerRow: Partial<PlayerPerGameRow> = {
      season_end_year: 0,
      age: null,
      team: '',
      pos: '',
      lg: '',
      g: totalG,
      gs: null,
      mp_per_game: avg('mp_per_game'),
      fg_per_game: avg('fg_per_game'),
      fga_per_game: avg('fga_per_game'),
      fg_percent: avgPct('fg_percent'),
      x3p_per_game: avg('x3p_per_game'),
      x3pa_per_game: avg('x3pa_per_game'),
      x3p_percent: avgPct('x3p_percent'),
      x2p_per_game: avg('x2p_per_game'),
      x2pa_per_game: avg('x2pa_per_game'),
      x2p_percent: avgPct('x2p_percent'),
      e_fg_percent: avg('e_fg_percent'),
      ft_per_game: avg('ft_per_game'),
      fta_per_game: avg('fta_per_game'),
      ft_percent: avgPct('ft_percent'),
      orb_per_game: avg('orb_per_game'),
      drb_per_game: avg('drb_per_game'),
      trb_per_game: avg('trb_per_game'),
      ast_per_game: avg('ast_per_game'),
      stl_per_game: avg('stl_per_game'),
      blk_per_game: avg('blk_per_game'),
      tov_per_game: avg('tov_per_game'),
      pf_per_game: avg('pf_per_game'),
      pts_per_game: avg('pts_per_game'),
    };
    summaries.push({
      label: `${validRows.length > 0 ? validRows.length : rows.length} Yrs`,
      isBold: true,
      row: careerRow,
    });

    // Per-team rows (only if player played for multiple teams, skip aggregate markers)
    if (teamGroups.size > 1) {
      for (const [team, teamRows] of teamGroups) {
        if (team === '2TM' || team === 'TOT') continue;
        const tG = teamRows.reduce((s, r) => s + (Number(r.g) || 0), 0);
        if (tG === 0) continue;
        const tAvg = (key: keyof PlayerPerGameRow): number =>
          teamRows.reduce((s, r) => s + (Number(r[key]) || 0) * (Number(r.g) || 0), 0) / tG;
        const tRow: Partial<PlayerPerGameRow> = {
          season_end_year: 0,
          age: null,
          team,
          pos: '',
          lg: '',
          g: tG,
          gs: null,
          mp_per_game: tAvg('mp_per_game'),
          fg_per_game: tAvg('fg_per_game'),
          fga_per_game: tAvg('fga_per_game'),
          fg_percent: tAvg('fg_percent'),
          x3p_per_game: tAvg('x3p_per_game'),
          x3pa_per_game: tAvg('x3pa_per_game'),
          x3p_percent: tAvg('x3p_percent'),
          x2p_per_game: tAvg('x2p_per_game'),
          x2pa_per_game: tAvg('x2pa_per_game'),
          x2p_percent: tAvg('x2p_percent'),
          e_fg_percent: tAvg('e_fg_percent'),
          ft_per_game: tAvg('ft_per_game'),
          fta_per_game: tAvg('fta_per_game'),
          ft_percent: tAvg('ft_percent'),
          orb_per_game: tAvg('orb_per_game'),
          drb_per_game: tAvg('drb_per_game'),
          trb_per_game: tAvg('trb_per_game'),
          ast_per_game: tAvg('ast_per_game'),
          stl_per_game: tAvg('stl_per_game'),
          blk_per_game: tAvg('blk_per_game'),
          tov_per_game: tAvg('tov_per_game'),
          pf_per_game: tAvg('pf_per_game'),
          pts_per_game: tAvg('pts_per_game'),
        };
        const yrLabel = teamRows.length === 1 ? '1 Yr' : `${teamRows.length} Yrs`;
        summaries.push({ label: `${team} (${yrLabel})`, isBold: true, row: tRow });
      }
    }

    return summaries;
  }, [rows]);
}
