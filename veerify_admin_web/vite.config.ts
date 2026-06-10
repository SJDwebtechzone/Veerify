import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// The admin web is served behind /admin/ on the VPS (https://veerifyapp.com/admin/).
// Setting `base` here makes the build emit asset URLs prefixed with /admin/,
// AND populates import.meta.env.BASE_URL so React Router's basename matches
// automatically in both dev and production.
export default defineConfig({
  base: '/admin/',
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    open: '/admin/',
  },
});
