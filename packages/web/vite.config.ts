import { defineConfig } from 'vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

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
