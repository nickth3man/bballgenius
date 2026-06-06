import type { ReactNode } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PlayerResult } from '../../routes/time-machine/server-fns.js';
import { Badge } from '../ui';

export interface TimeMachineSearchPanelProps {
  onSearch: (query: string) => Promise<PlayerResult[]>;
  onSelectPlayer: (player: PlayerResult) => void;
  selectedPlayerId?: string | null;
}

export function TimeMachineSearchPanel({
  onSearch,
  onSelectPlayer,
  selectedPlayerId = null,
}: TimeMachineSearchPanelProps): ReactNode {
  const [search, setSearch] = useState('');
  const [players, setPlayers] = useState<PlayerResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const [showDropdown, setShowDropdown] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  const searchListboxId = 'time-machine-player-search-listbox';
  const activePlayerOptionId =
    showDropdown && highlightIndex >= 0 && players[highlightIndex]
      ? `time-machine-player-option-${players[highlightIndex].player_id}`
      : undefined;

  // Debounced auto-search: fires 300ms after typing stops
  useEffect(() => {
    if (!search.trim()) {
      setPlayers([]);
      setShowDropdown(false);
      return;
    }
    const timer = setTimeout(async () => {
      setSearchLoading(true);
      setError(null);
      try {
        const result = await onSearch(search);
        setPlayers(result);
        setShowDropdown(true);
        setHighlightIndex(-1);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setSearchLoading(false);
      }
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, onSearch]);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const manualSearch = useCallback(async () => {
    if (!search.trim()) return;
    setSearchLoading(true);
    setError(null);
    try {
      const result = await onSearch(search);
      setPlayers(result);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSearchLoading(false);
    }
  }, [search, onSearch]);

  return (
    <div className="w-80 shrink-0 overflow-auto border-r border-border bg-surface p-3">
      <h2 className="mb-1 text-sm font-bold text-primary">Player Search</h2>
      <p className="mb-2 text-[10px] text-fg-dim">Start typing to find any NBA player</p>
      <div ref={searchRef} className="relative mb-2">
        <input
          id="time-machine-player-search"
          name="time-machine-player-search"
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-controls={searchListboxId}
          aria-expanded={showDropdown && players.length > 0}
          aria-activedescendant={activePlayerOptionId}
          aria-describedby="time-machine-player-search-status"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setShowDropdown(true);
          }}
          onFocus={() => players.length > 0 && setShowDropdown(true)}
          onKeyDown={(e) => {
            if (!showDropdown || players.length === 0) {
              if (e.key === 'Enter') void manualSearch();
              return;
            }
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setHighlightIndex((i) => Math.min(i + 1, players.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setHighlightIndex((i) => Math.max(i - 1, 0));
            } else if (e.key === 'Enter' && highlightIndex >= 0) {
              e.preventDefault();
              void onSelectPlayer(players[highlightIndex]!);
              setShowDropdown(false);
            } else if (e.key === 'Escape') {
              setShowDropdown(false);
            }
          }}
          placeholder="Search any NBA player..."
          className="w-full rounded border border-border bg-bg px-2 py-1.5 pr-7 text-xs text-fg outline-none placeholder:text-fg-dim focus:border-primary"
        />
        {searchLoading && (
          <div className="absolute right-2 top-1/2 -translate-y-1/2">
            <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        )}
        <output id="time-machine-player-search-status" className="sr-only">
          {search.trim() && !searchLoading
            ? `${players.length} player${players.length === 1 ? '' : 's'} found for ${search.trim()}`
            : 'Type to search NBA players'}
        </output>
        {error && <div className="mb-2 rounded bg-danger/10 p-2 text-xs text-danger">{error}</div>}

        {showDropdown && players.length > 0 && (
          <div
            id={searchListboxId}
            role="listbox"
            className="absolute left-0 right-0 top-full z-50 mt-0.5 max-h-64 overflow-auto rounded border border-border bg-surface shadow-lg"
          >
            {players.map((p, idx) => (
              <div
                key={p.player_id}
                id={`time-machine-player-option-${p.player_id}`}
                role="option"
                aria-selected={idx === highlightIndex}
                tabIndex={-1}
                onMouseDown={() => {
                  void onSelectPlayer(p);
                  setShowDropdown(false);
                }}
                onMouseEnter={() => setHighlightIndex(idx)}
                className={`block w-full px-2 py-1.5 text-left text-xs transition-colors ${
                  idx === highlightIndex
                    ? 'bg-primary/20 text-fg'
                    : 'text-fg-muted hover:bg-surface-alt'
                } ${selectedPlayerId === p.player_id ? 'border-l-2 border-primary' : ''}`}
              >
                <div className="flex items-baseline gap-2">
                  <span className="font-medium">{p.full_name}</span>
                  {p.position ? (
                    <span className="rounded border border-border/60 bg-surface-alt/40 px-1 text-[9px] font-mono uppercase text-fg-dim">
                      {p.position}
                    </span>
                  ) : null}
                </div>
                <div className="text-fg-dim">
                  {p.from_year}–{p.is_active ? 'Present' : p.to_year}
                  {p.is_active && (
                    <span className="ml-1 inline-flex items-center">
                      <Badge tone="success" dot size="sm">
                        Active
                      </Badge>
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {!searchLoading && search.trim() && players.length === 0 && (
          <div className="mt-2 rounded border border-warning/20 bg-warning/5 p-2 text-xs text-warning/90">
            <Badge tone="warning" size="sm">
              No match
            </Badge>{' '}
            No players found for &ldquo;{search.trim()}&rdquo;
          </div>
        )}
      </div>
    </div>
  );
}
