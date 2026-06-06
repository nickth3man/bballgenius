import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

// Running `bun --filter web dev` sets cwd to packages/web, so Bun's automatic
// .env loading misses the repo-root .env (where OPENROUTER_API_KEY etc. live).
// Load it explicitly and merge into process.env so server route handlers
// (e.g. /api/chat-stream) can read it. These stay server-side — they are not
// injected into the client bundle unless referenced via import.meta.env.
const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const rootEnv = loadEnv(process.env['NODE_ENV'] || 'development', repoRoot, '');
for (const [key, value] of Object.entries(rootEnv)) {
  if (process.env[key] === undefined) process.env[key] = value;
}

export default defineConfig({
  server: {
    port: 3000,
  },
  ssr: {
    // Native bindings stay external — Node resolves them via the workspace
    // install and the addon loader handles .node files.
    external: ['@duckdb/node-api', '@duckdb/node-bindings'],
    // Bundle the LangChain/LangGraph stack so Vite resolves its subpath
    // imports (e.g. `langsmith/run_trees`) at build time.
    // Everything else stays external — Node resolves CJS deps like `p-queue`
    // and `mustache` at runtime, avoiding the `exports is not defined` error
    // that Vite's inlined module runner throws when it tries to evaluate raw
    // CJS. Native bindings (DuckDB) are externalized via `ssr.external` below.
    noExternal: [
      '@langchain/core',
      '@langchain/openai',
      '@langchain/langgraph',
      'langchain',
      /^langsmith(\/|$)/,
    ],
  },
  optimizeDeps: {
    exclude: ['@duckdb/node-api', '@duckdb/node-bindings'],
  },
  plugins: [tanstackStart(), react(), tailwindcss()],
});
