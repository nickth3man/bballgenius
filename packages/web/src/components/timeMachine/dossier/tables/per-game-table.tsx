import type { PlayerAwardRow, PlayerPerGameRow } from 'data/tabs/time-machine/queries';
import { type ReactNode, useMemo } from 'react';
import { formatNumber, formatPct, formatSeason } from '../../../../utils/formatters.js';
import { PctBar } from '../../../ui/pct-bar.js';
import { useCareerSummary } from '../hooks/use-career-summary.js';
import { useSortableTable } from '../hooks/use-sortable-table.js';
import { highlightClass } from '../internal/highlight.js';

interface PerGameTableProps {
  rows: PlayerPerGameRow[];
  awards: PlayerAwardRow[];
  activeSort?: string;
  activeSortDir?: 'asc' | 'desc';
  onSortChange?: (col: string | null, dir: 'asc' | 'desc') => void;
}

function PerGameTable({
  rows,
  awards,
  activeSort,
  activeSortDir,
  onSortChange,
}: PerGameTableProps): ReactNode {
  const best = (arr: number[]) => (arr.length > 1 ? Math.max(...arr) : null);
  const worst = (arr: number[]) => (arr.length > 1 ? Math.min(...arr) : null);

  // Hooks must be called unconditionally, before any early returns
  const ptsValues = useMemo(
    () => rows.map((r) => Number(r.pts_per_game)).filter(Number.isFinite),
    [rows],
  );
  const astValues = useMemo(
    () => rows.map((r) => Number(r.ast_per_game)).filter(Number.isFinite),
    [rows],
  );
  const trbValues = useMemo(
    () => rows.map((r) => Number(r.trb_per_game)).filter(Number.isFinite),
    [rows],
  );
  const stlValues = useMemo(
    () => rows.map((r) => Number(r.stl_per_game)).filter(Number.isFinite),
    [rows],
  );
  const blkValues = useMemo(
    () => rows.map((r) => Number(r.blk_per_game)).filter(Number.isFinite),
    [rows],
  );
  const mpValues = useMemo(
    () => rows.map((r) => Number(r.mp_per_game)).filter(Number.isFinite),
    [rows],
  );

  // Build awards lookup by season_end_year
  const awardsBySeason = useMemo(() => {
    const map = new Map<number, string[]>();
    for (const a of awards) {
      // Extract year from season label like "1975-76"
      const seasonStr = typeof a.season_year === 'string' ? a.season_year : String(a.season_year);
      const match = seasonStr.match(/(\d{4})-\d{2}/);
      if (match) {
        const endYear = Number(match[1]) + 1;
        const existing = map.get(endYear) ?? [];
        existing.push(String(a.award));
        map.set(endYear, existing);
      }
    }
    return map;
  }, [awards]);

  // Column sorting state
  const { sortCol, sortDir, sortedRows, handleSort } = useSortableTable<PlayerPerGameRow>(rows, {
    initialSortCol: activeSort ?? null,
    initialSortDir: activeSortDir ?? 'asc',
    getValue: (r, col) => {
      const v = (r as unknown as Record<string, unknown>)[col];
      return typeof v === 'number' ? v : Number(v) || 0;
    },
    ...(onSortChange !== undefined ? { onSortChange } : {}),
  });

  // Compute career summary rows
  const summaryRows = useCareerSummary(rows);

  const perGameHeaders = [
    'Season',
    'Age',
    'Tm',
    'Lg',
    'Pos',
    'G',
    'GS',
    'MP',
    'FG',
    'FGA',
    'FG%',
    '3P',
    '3PA',
    '3P%',
    '2P',
    '2PA',
    '2P%',
    'eFG%',
    'FT',
    'FTA',
    'FT%',
    'ORB',
    'DRB',
    'TRB',
    'AST',
    'STL',
    'BLK',
    'TOV',
    'PF',
    'PTS',
    'Awards',
  ];

  const sortKeyMap: Record<string, string> = {
    Season: 'season_end_year',
    Age: 'age',
    Tm: 'team',
    Lg: 'lg',
    Pos: 'pos',
    G: 'g',
    GS: 'gs',
    MP: 'mp_per_game',
    FG: 'fg_per_game',
    FGA: 'fga_per_game',
    'FG%': 'fg_percent',
    '3P': 'x3p_per_game',
    '3PA': 'x3pa_per_game',
    '3P%': 'x3p_percent',
    '2P': 'x2p_per_game',
    '2PA': 'x2pa_per_game',
    '2P%': 'x2p_percent',
    'eFG%': 'e_fg_percent',
    FT: 'ft_per_game',
    FTA: 'fta_per_game',
    'FT%': 'ft_percent',
    ORB: 'orb_per_game',
    DRB: 'drb_per_game',
    TRB: 'trb_per_game',
    AST: 'ast_per_game',
    STL: 'stl_per_game',
    BLK: 'blk_per_game',
    TOV: 'tov_per_game',
    PF: 'pf_per_game',
    PTS: 'pts_per_game',
  };

  const renderCell = (r: PlayerPerGameRow | Partial<PlayerPerGameRow>, col: string) => {
    switch (col) {
      case 'Season':
        if ('season_end_year' in r && r.season_end_year && r.season_end_year > 0)
          return formatSeason(r.season_end_year);
        return (r as { label?: string }).label ?? '\u2014';
      case 'Age':
        return r.age ?? '\u2014';
      case 'Tm':
        return r.team === '2TM' ? (
          <span className="italic text-fg-dim">{r.team}</span>
        ) : (
          (r.team ?? '\u2014')
        );
      case 'Lg':
        return ('lg' in r ? r.lg : '\u2014') ?? '\u2014';
      case 'Pos':
        return r.pos ?? '\u2014';
      case 'G':
        return r.g ?? '\u2014';
      case 'GS':
        return r.gs ?? '\u2014';
      case 'MP':
        return (
          <span className={highlightClass(r.mp_per_game, best(mpValues), worst(mpValues))}>
            {formatNumber(r.mp_per_game)}
          </span>
        );
      case 'FG':
        return formatNumber(r.fg_per_game);
      case 'FGA':
        return formatNumber(r.fga_per_game);
      case 'FG%':
        return <PctBar value={r.fg_percent} />;
      case '3P':
        return formatNumber(r.x3p_per_game, 1);
      case '3PA':
        return formatNumber(r.x3pa_per_game, 1);
      case '3P%':
        return <PctBar value={r.x3p_percent} />;
      case '2P':
        return formatNumber(r.x2p_per_game, 1);
      case '2PA':
        return formatNumber(r.x2pa_per_game, 1);
      case '2P%':
        return <PctBar value={r.x2p_percent} />;
      case 'eFG%':
        return <PctBar value={r.e_fg_percent} />;
      case 'FT':
        return formatNumber(r.ft_per_game, 1);
      case 'FTA':
        return formatNumber(r.fta_per_game, 1);
      case 'FT%':
        return <PctBar value={r.ft_percent} />;
      case 'ORB':
        return formatNumber(r.orb_per_game, 1);
      case 'DRB':
        return formatNumber(r.drb_per_game, 1);
      case 'TRB':
        return (
          <span className={highlightClass(r.trb_per_game, best(trbValues), worst(trbValues))}>
            {formatNumber(r.trb_per_game, 1)}
          </span>
        );
      case 'AST':
        return (
          <span className={highlightClass(r.ast_per_game, best(astValues), worst(astValues))}>
            {formatNumber(r.ast_per_game, 1)}
          </span>
        );
      case 'STL':
        return (
          <span className={highlightClass(r.stl_per_game, best(stlValues), worst(stlValues))}>
            {formatNumber(r.stl_per_game, 1)}
          </span>
        );
      case 'BLK':
        return (
          <span className={highlightClass(r.blk_per_game, best(blkValues), worst(blkValues))}>
            {formatNumber(r.blk_per_game, 1)}
          </span>
        );
      case 'TOV':
        return formatNumber(r.tov_per_game, 1);
      case 'PF':
        return formatNumber(r.pf_per_game, 1);
      case 'PTS':
        return (
          <span className={highlightClass(r.pts_per_game, best(ptsValues), worst(ptsValues))}>
            {formatNumber(r.pts_per_game, 1)}
          </span>
        );
      case 'Awards':
        if ('season_end_year' in r && r.season_end_year && r.season_end_year > 0) {
          const yrAwards = awardsBySeason.get(Number(r.season_end_year));
          return yrAwards?.length ? yrAwards.join(', ') : '';
        }
        return '';
      default:
        return '';
    }
  };

  const getStickyClass = (col: string): string => {
    switch (col) {
      case 'Season':
        return 'sticky left-0 z-[5] bg-surface';
      case 'Age':
        return 'sticky left-[4.5rem] z-[5] bg-surface';
      case 'Tm':
        return 'sticky left-[7rem] z-[5] bg-surface';
      case 'G':
        return 'sticky left-[9.5rem] z-[5] bg-surface';
      default:
        return '';
    }
  };

  return (
    <div className="relative">
      {/* Mobile: season stat cards */}
      <div className="md:hidden space-y-2">
        {sortedRows.map((r) => (
          <div
            key={`card-${r.season_end_year}-${r.team ?? ''}`}
            className="rounded-lg border border-border/60 bg-surface-alt/30 p-3"
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-bold text-fg">{formatSeason(r.season_end_year)}</span>
              <span className="rounded bg-surface px-1.5 py-0.5 text-[10px] font-mono text-fg-dim">
                {r.team ?? '\u2014'} &middot; {r.pos ?? '\u2014'} &middot; {r.g ?? '\u2014'} G
              </span>
            </div>
            <div className="grid grid-cols-3 gap-x-2 gap-y-1.5 text-center">
              <div>
                <div className="text-[9px] text-fg-dim">PTS</div>
                <div className="text-xs font-semibold">{formatNumber(r.pts_per_game, 1)}</div>
              </div>
              <div>
                <div className="text-[9px] text-fg-dim">REB</div>
                <div className="text-xs font-semibold">{formatNumber(r.trb_per_game, 1)}</div>
              </div>
              <div>
                <div className="text-[9px] text-fg-dim">AST</div>
                <div className="text-xs font-semibold">{formatNumber(r.ast_per_game, 1)}</div>
              </div>
              <div>
                <div className="text-[9px] text-fg-dim">STL</div>
                <div className="text-xs font-semibold">{formatNumber(r.stl_per_game, 1)}</div>
              </div>
              <div>
                <div className="text-[9px] text-fg-dim">BLK</div>
                <div className="text-xs font-semibold">{formatNumber(r.blk_per_game, 1)}</div>
              </div>
              <div>
                <div className="text-[9px] text-fg-dim">MP</div>
                <div className="text-xs font-semibold">{formatNumber(r.mp_per_game, 1)}</div>
              </div>
              <div>
                <div className="text-[9px] text-fg-dim">FG%</div>
                <div className="text-xs font-semibold">{formatPct(r.fg_percent)}</div>
              </div>
              <div>
                <div className="text-[9px] text-fg-dim">3P%</div>
                <div className="text-xs font-semibold">{formatPct(r.x3p_percent)}</div>
              </div>
              <div>
                <div className="text-[9px] text-fg-dim">FT%</div>
                <div className="text-xs font-semibold">{formatPct(r.ft_percent)}</div>
              </div>
            </div>
          </div>
        ))}
        {summaryRows.map((s) => (
          <div
            key={`card-summary-${s.label.replace(/\s+/g, '-')}`}
            className="rounded-lg border-2 border-primary/20 bg-primary/5 p-3"
          >
            <div className="mb-2 text-sm font-bold text-fg">{s.label}</div>
            <div className="grid grid-cols-3 gap-x-2 gap-y-1.5 text-center">
              <div>
                <div className="text-[9px] text-fg-dim">PTS</div>
                <div className="text-xs font-semibold">{formatNumber(s.row.pts_per_game, 1)}</div>
              </div>
              <div>
                <div className="text-[9px] text-fg-dim">REB</div>
                <div className="text-xs font-semibold">{formatNumber(s.row.trb_per_game, 1)}</div>
              </div>
              <div>
                <div className="text-[9px] text-fg-dim">AST</div>
                <div className="text-xs font-semibold">{formatNumber(s.row.ast_per_game, 1)}</div>
              </div>
              <div>
                <div className="text-[9px] text-fg-dim">STL</div>
                <div className="text-xs font-semibold">{formatNumber(s.row.stl_per_game, 1)}</div>
              </div>
              <div>
                <div className="text-[9px] text-fg-dim">BLK</div>
                <div className="text-xs font-semibold">{formatNumber(s.row.blk_per_game, 1)}</div>
              </div>
              <div>
                <div className="text-[9px] text-fg-dim">FG%</div>
                <div className="text-xs font-semibold">{formatPct(s.row.fg_percent)}</div>
              </div>
              <div>
                <div className="text-[9px] text-fg-dim">3P%</div>
                <div className="text-xs font-semibold">{formatPct(s.row.x3p_percent)}</div>
              </div>
              <div>
                <div className="text-[9px] text-fg-dim">FT%</div>
                <div className="text-xs font-semibold">{formatPct(s.row.ft_percent)}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
      {/* Desktop: table */}
      <div className="hidden md:block">
        {/* Right-edge fade scroll indicator */}
        <div className="pointer-events-none absolute right-0 top-0 z-10 h-full w-8 bg-gradient-to-l from-surface/80 to-transparent" />
        {/* Bottom-edge fade scroll indicator */}
        <div className="pointer-events-none absolute bottom-0 left-0 z-10 h-6 w-full bg-gradient-to-t from-surface/60 to-transparent" />
        <table className="min-w-full font-mono text-xs">
          <thead className="sticky top-0 z-10">
            <tr className="bg-surface text-fg-dim">
              {perGameHeaders.map((h) => {
                const sortKey = sortKeyMap[h];
                const isActive = sortCol === sortKey;
                return (
                  <th
                    key={h}
                    onClick={sortKey ? () => handleSort(sortKey) : undefined}
                    aria-sort={
                      isActive
                        ? sortDir === 'asc'
                          ? 'ascending'
                          : 'descending'
                        : sortKey
                          ? 'none'
                          : undefined
                    }
                    className={`border-b-2 border-border px-2 py-1.5 text-left font-semibold whitespace-nowrap ${getStickyClass(h)} ${sortKey ? 'cursor-pointer hover:text-fg select-none' : ''}`}
                  >
                    <span className="inline-flex items-center gap-0.5">
                      {h}
                      {isActive && (
                        <span className="text-[8px] leading-none">
                          {sortDir === 'desc' ? '\u25BC' : '\u25B2'}
                        </span>
                      )}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {/* Season rows */}
            {sortedRows.map((r) => (
              <tr
                key={`per-game-${r.season_end_year}-${r.team ?? ''}-${r.pos ?? ''}`}
                className="border-b border-surface-alt/50 text-fg-muted last:border-b-0 hover:bg-surface-alt/40 transition-colors even:bg-surface-alt/20"
              >
                {perGameHeaders.map((col) => (
                  <td
                    key={col}
                    className={`px-2 py-0.5 ${getStickyClass(col)} ${col === 'Season' ? 'font-medium text-fg whitespace-nowrap' : ''}`}
                  >
                    {renderCell(r, col)}
                  </td>
                ))}
              </tr>
            ))}
            {/* Summary rows */}
            {summaryRows.map((s) => (
              <tr
                key={`summary-pergame-${s.label.replace(/\s+/g, '-')}`}
                className={`border-t-2 border-border text-fg last:border-b-0 ${
                  s.isBold ? 'font-bold' : 'font-medium'
                } bg-surface-alt/40`}
              >
                {perGameHeaders.map((col) => (
                  <td
                    key={col}
                    className={`px-2 py-0.5 ${getStickyClass(col)} ${
                      col === 'Season'
                        ? 'font-bold text-fg whitespace-nowrap'
                        : col === 'Age' || col === 'Tm' || col === 'G'
                          ? 'text-fg-muted'
                          : ''
                    }`}
                  >
                    {col === 'Season' ? s.label : renderCell(s.row as PlayerPerGameRow, col)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export { PerGameTable };
