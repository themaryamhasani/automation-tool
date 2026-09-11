import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  envDir: resolve(__dirname, '../..'),
  plugins: [react(), tailwindcss()],
  optimizeDeps: {
    include: ['monaco-editor', '@monaco-editor/react'],
  },
  worker: { format: 'es' },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('monaco-editor')) return 'monaco';
        },
      },
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5180,
    strictPort: true,
    proxy: {
      '/api': {
        target: process.env.API_BASE_URL || 'http://localhost:4280',
        changeOrigin: true,
        timeout: 0,
        proxyTimeout: 0,
      },
    },
  },
  preview: {
    host: '127.0.0.1',
    port: 5180,
    proxy: {
      '/api': {
        target: process.env.API_BASE_URL || 'http://127.0.0.1:4280',
        changeOrigin: true,
        timeout: 0,
        proxyTimeout: 0,
      },
    },
  },
});
