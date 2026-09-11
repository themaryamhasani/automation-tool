import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

function exactOrigin(value: string, fallback: string): string {
  const parsed = new URL(value || fallback);
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error(`Invalid configured origin: ${value}`);
  return parsed.origin;
}

function chromeOriginPattern(origin: string): string {
  const parsed = new URL(origin);
  return `${parsed.protocol}//${parsed.hostname}/*`;
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, resolve(__dirname, '../..'), '');
  const apiOrigin = exactOrigin(process.env.AUTOMATION_TOOL_API_ORIGIN || env.AUTOMATION_TOOL_API_ORIGIN, 'http://localhost:4280');
  const webOrigin = exactOrigin(process.env.AUTOMATION_TOOL_WEB_ORIGIN || env.AUTOMATION_TOOL_WEB_ORIGIN, 'http://localhost:5180');
  const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')) as { version: string };
  return {
  plugins: [react(), {
    name: 'automation-tool-production-manifest',
    closeBundle() {
      const path = resolve(__dirname, 'dist/manifest.json');
      const manifest = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
      manifest.version = pkg.version;
      manifest.host_permissions = [chromeOriginPattern(apiOrigin)];
      manifest.externally_connectable = { matches: [chromeOriginPattern(webOrigin)] };
      writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    },
  }],
  define: {
    __AUTOMATION_TOOL_API_ORIGIN__: JSON.stringify(apiOrigin),
    __AUTOMATION_TOOL_WEB_ORIGIN__: JSON.stringify(webOrigin),
  },
  publicDir: 'public',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    minify: false,
    chunkSizeWarningLimit: 12_000,
    rollupOptions: {
      input: {
        sidepanel: resolve(__dirname, 'sidepanel.html'),
        options: resolve(__dirname, 'options.html'),
        traceDownload: resolve(__dirname, 'trace-download.html'),
        background: resolve(__dirname, 'src/background/index.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
  };
});
