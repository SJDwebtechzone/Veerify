// vite.config.js — Vite build config for the public site.
//
// If you already have an admin Vite project, DUPLICATE its config
// into a new /veerify-public folder. Do not merge into the admin's
// vite.config — they should build separately so /admin and /
// stay decoupled.

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Build output goes to dist/. Nginx serves from this directory.
  build: {
    outDir: 'dist',
    // Small production optimisation — inline anything under 4KB so
    // the initial page load is 1 request.
    assetsInlineLimit: 4096,
  },
  // Dev-only: proxy /api to the local backend so relative fetches
  // work during npm run dev. Production nginx does the same
  // proxying at the reverse-proxy layer.
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
    },
  },
});
