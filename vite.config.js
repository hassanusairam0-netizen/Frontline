import { defineConfig } from 'vite';

// The game server (server/index.js) listens on 8787. In development Vite proxies
// the /ws socket and /api routes to it so the client always talks to its own origin.
export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      '/ws': { target: 'ws://localhost:8787', ws: true },
      '/api': { target: 'http://localhost:8787' },
    },
  },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1200,
  },
});
