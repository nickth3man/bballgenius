import { createFileRoute } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { type ReactNode, useCallback, useRef, useState } from 'react';
import { CodeEditor } from '../components/code-editor';
import { ResultsTable } from '../components/results-table';
import { SchemaTree } from '../components/schema-tree';

interface QueryResult {
  rows: Record<string, unknown>[];
  elapsedMs: number;
}

interface SchemaNode {
  name: string;
  type: 'schema' | 'table' | 'column';
  children?: SchemaNode[];
  expanded?: boolean;
}

const runQueryFn = createServerFn({ method: 'POST', strict: { output: false } })
  .inputValidator((data: { sql: string }) => data)
  .handler(async ({ data }) => {
    const { query } = await import('data');
    const rows = await query<Record<string, unknown>>(data.sql);
    return rows as Record<string, unknown>[];
  });

export const Route = createFileRoute('/sql-sandbox')({
  component: SqlSandboxPage,
});

function SqlSandboxPage(): ReactNode {
  const [sqlText, setSqlText] = useState('SELECT * FROM dim_player LIMIT 10');
  const [results, setResults] = useState<QueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const [schemaNodes] = useState<SchemaNode[]>(() => buildSampleSchema());

  const runQuery = useCallback(async () => {
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    setResults(null);

    try {
      const start = performance.now();
      const rows = await runQueryFn({ data: { sql: sqlText } });
      const elapsedMs = Math.round(performance.now() - start);

      if (controller.signal.aborted) return;

      setResults({ rows: rows as Record<string, unknown>[], elapsedMs });
    } catch (e: unknown) {
      if (controller.signal.aborted) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
      }
    }
  }, [sqlText]);

  const cancelQuery = useCallback(() => {
    abortRef.current?.abort();
    setLoading(false);
  }, []);

  const handleSelectTable = useCallback((tableName: string) => {
    setSqlText((prev) => {
      const suffix = `SELECT * FROM ${tableName}`;
      if (prev.includes('SELECT')) {
        return `${prev}${prev.endsWith(';') || prev.endsWith(' ') ? '' : '\n'}${suffix}`;
      }
      return suffix;
    });
  }, []);

  const handleSelectColumn = useCallback((_tableName: string, columnName: string) => {
    setSqlText((prev) => `${prev}, ${columnName}`);
  }, []);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <h2 className="text-sm font-bold text-primary">SQL Sandbox</h2>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={runQuery}
            disabled={loading}
            className="rounded bg-primary px-4 py-1 text-sm font-medium text-bg hover:bg-primary/90 disabled:opacity-50"
          >
            {loading ? 'Running...' : 'Run (Ctrl+Enter)'}
          </button>
          {loading && (
            <button
              type="button"
              onClick={cancelQuery}
              className="rounded bg-danger/20 px-3 py-1 text-sm text-danger hover:bg-danger/30"
            >
              Cancel
            </button>
          )}
        </div>
      </div>
      <div className="flex flex-1 overflow-hidden">
        <div className="w-56 shrink-0 border-r border-border">
          <SchemaTree
            nodes={schemaNodes}
            onSelectTable={handleSelectTable}
            onSelectColumn={handleSelectColumn}
          />
        </div>
        <div className="flex flex-1 flex-col">
          <div className="h-40 border-b border-border">
            <CodeEditor value={sqlText} onChange={setSqlText} onRun={runQuery} />
          </div>
          <div className="flex-1 overflow-auto p-2">
            <ResultsTable
              data={results?.rows ?? []}
              loading={loading}
              error={error}
              elapsedMs={results?.elapsedMs}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function buildSampleSchema(): SchemaNode[] {
  return [
    {
      name: 'main',
      type: 'schema',
      children: [
        {
          name: 'dim_game',
          type: 'table',
          children: [
            { name: 'game_id', type: 'column' },
            { name: 'game_date', type: 'column' },
            { name: 'season_year', type: 'column' },
            { name: 'home_team_id', type: 'column' },
            { name: 'away_team_id', type: 'column' },
          ],
        },
        {
          name: 'dim_player',
          type: 'table',
          children: [
            { name: 'player_id', type: 'column' },
            { name: 'full_name', type: 'column' },
            { name: 'is_active', type: 'column' },
            { name: 'from_year', type: 'column' },
            { name: 'to_year', type: 'column' },
          ],
        },
        {
          name: 'dim_team',
          type: 'table',
          children: [
            { name: 'team_id', type: 'column' },
            { name: 'team_abbrev', type: 'column' },
            { name: 'team_name', type: 'column' },
            { name: 'season_active_till', type: 'column' },
          ],
        },
        {
          name: 'fact_player_game_stats',
          type: 'table',
          children: [
            { name: 'player_id', type: 'column' },
            { name: 'game_id', type: 'column' },
            { name: 'team_id', type: 'column' },
            { name: 'points', type: 'column' },
            { name: 'assists', type: 'column' },
            { name: 'reb', type: 'column' },
            { name: 'steals', type: 'column' },
            { name: 'blocks', type: 'column' },
            { name: 'min', type: 'column' },
            { name: 'action_type', type: 'column' },
            { name: 'shot_result', type: 'column' },
            { name: 'x', type: 'column' },
            { name: 'y', type: 'column' },
          ],
        },
        {
          name: 'fact_team_game',
          type: 'table',
          children: [
            { name: 'team_id', type: 'column' },
            { name: 'game_id', type: 'column' },
            { name: 'pts_qtr1', type: 'column' },
            { name: 'pts_qtr2', type: 'column' },
            { name: 'pts_qtr3', type: 'column' },
            { name: 'pts_qtr4', type: 'column' },
          ],
        },
      ],
    },
    {
      name: 'nbadb',
      type: 'schema',
      children: [
        { name: 'dim_game', type: 'table' },
        { name: 'dim_player', type: 'table' },
        { name: 'dim_team', type: 'table' },
        { name: 'fact_game_result', type: 'table' },
        { name: 'fact_player_game_stats', type: 'table' },
      ],
    },
  ];
}
