import { defineConfig } from 'vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  server: {
    port: 3000,
  },
  ssr: {
    external: [
      '@duckdb/node-api',
      '@duckdb/node-bindings',
    ],
  },
  optimizeDeps: {
    exclude: [
      '@duckdb/node-api',
      '@duckdb/node-bindings',
    ],
  },
  plugins: [
    tanstackStart(),
    react(),
    tailwindcss(),
  ],
});
