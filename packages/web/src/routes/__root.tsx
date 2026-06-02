import type { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, Link, Outlet } from '@tanstack/react-router';
import type { ReactNode } from 'react';

interface RouterContext {
  queryClient: QueryClient;
}

const TABS = [
  { id: 'game-center', label: 'Game Center', path: '/game-center', enabled: true },
  { id: 'time-machine', label: 'Career Time-Machine', path: '/time-machine', enabled: true },
  { id: 'sql-sandbox', label: 'SQL Sandbox', path: '/sql-sandbox', enabled: true },
  { id: 'chat', label: 'Chat', path: '/chat', enabled: true },
] as const;

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
});

function RootLayout(): ReactNode {
  return (
    <div className="flex h-full flex-col bg-bg text-fg">
      <header className="flex items-center border-b border-border bg-surface px-4 py-2">
        <div className="font-bold text-primary">BBallGenius</div>
        <nav className="ml-8 flex gap-1">
          {TABS.map((tab) => (
            <Link
              key={tab.id}
              to={tab.path}
              disabled={!tab.enabled}
              className="rounded px-3 py-1 text-sm text-fg-muted hover:bg-surface-alt data-[status=active]:bg-primary data-[status=active]:text-bg disabled:cursor-not-allowed disabled:opacity-40"
            >
              {tab.label}
            </Link>
          ))}
        </nav>
      </header>
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
      <footer className="border-t border-border bg-surface px-4 py-1 text-xs text-fg-dim">
        nba.duckdb · DuckDB + TanStack Start
      </footer>
    </div>
  );
}
