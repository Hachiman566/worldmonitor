import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: '/pro/',
  server: {
    proxy: {
      // Local billing requests stay local. Run the Vercel API at this origin.
      '/api/billing': { target: process.env.BILLING_DEV_API_ORIGIN || 'http://127.0.0.1:3001', changeOrigin: false },
    },
  },
  build: {
    outDir: path.resolve(__dirname, '../public/pro'),
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
});
