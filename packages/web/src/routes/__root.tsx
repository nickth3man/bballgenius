import type { QueryClient } from '@tanstack/react-query';
import {
  createRootRouteWithContext,
  HeadContent,
  Link,
  Outlet,
  Scripts,
} from '@tanstack/react-router';
import type { ReactNode } from 'react';
import appCss from '../styles/app.css?url';

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
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      {
        name: 'description',
        content:
          'BBallGenius — Explore NBA data, player stats, game box scores, shot charts, and career timelines powered by DuckDB.',
      },
      { title: 'BBallGenius' },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      { rel: 'icon', href: '/mark.svg', type: 'image/svg+xml' },
      { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
      {
        rel: 'preconnect',
        href: 'https://fonts.gstatic.com',
        crossOrigin: 'anonymous',
      },
      {
        rel: 'stylesheet',
        href: 'https://fonts.googleapis.com/css2?family=Saira:wght@400;500;600;700;800&family=Archivo:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap',
      },
    ],
  }),
  shellComponent: RootDocument,
  component: RootLayout,
});

function RootDocument({ children }: { children: ReactNode }): ReactNode {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootLayout(): ReactNode {
  return (
    <div className="flex h-full flex-col bg-bg text-fg">
      <header className="flex items-center border-b border-border bg-surface px-4 py-2">
        <Link to="/game-center" className="flex items-center gap-2" aria-label="BBallGenius home">
          <img src="/mark.svg" alt="" width={28} height={28} className="rounded" />
          <span
            className="font-display text-base font-bold tracking-tight"
            style={{ color: 'var(--text-primary)' }}
          >
            BBall<span style={{ color: 'var(--accent)' }}>Genius</span>
          </span>
        </Link>
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
