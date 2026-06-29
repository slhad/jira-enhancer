import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const DEFAULT_ALLOWED_SITES = ['https://*.atlassian.net/*', 'https://*.jira.com/*'];

function parseAllowedSites(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((site) => site.trim())
    .filter(Boolean);
}

function manifestAllowedSitesPlugin(allowedSites: string[]): Plugin {
  return {
    name: 'jira-enhancer-manifest-allowed-sites',
    writeBundle() {
      const manifestPath = path.resolve('dist/manifest.json');
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as {
        host_permissions?: string[];
        content_scripts?: Array<{ matches?: string[] }>;
      };

      manifest.host_permissions = allowedSites;
      manifest.content_scripts = manifest.content_scripts?.map((script) => ({
        ...script,
        matches: allowedSites,
      }));

      fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    },
  };
}

export default defineConfig(({ mode }) => {
  const configDir = path.dirname(fileURLToPath(import.meta.url));
  const rootDir = path.resolve(configDir, '../..');
  const env = {
    ...loadEnv(mode, rootDir, ''),
    ...loadEnv(mode, configDir, ''),
  };
  const allowedSites = parseAllowedSites(env.ALLOWED_SITES);

  return {
    plugins: [
      react(),
      manifestAllowedSitesPlugin(allowedSites.length > 0 ? allowedSites : DEFAULT_ALLOWED_SITES),
    ],
    test: {
      globals: true,
      include: ['__tests__/**/*.test.ts'],
      environment: 'jsdom',
      coverage: {
        all: false,
        reporter: ['text', 'json-summary'],
        thresholds: {
          lines: 90,
          branches: 90,
          functions: 90,
          statements: 90,
        },
        exclude: [
          '**/node_modules/**',
          '**/dist/**',
          '**/__tests__/**',
          '**/src/popup/main.tsx',
          '**/src/popup/**',
          '**/src/content/inject.ts',
        ],
      },
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      rollupOptions: {
        input: {
          background: 'src/background/background.ts',
          content: 'src/content/inject.ts',
          popup: 'src/popup/index.html',
          fullPage: 'src/full-page/index.html',
        },
        output: {
          entryFileNames: '[name].js',
          chunkFileNames: 'chunks/[name].js',
          assetFileNames: 'assets/[name].[ext]',
        },
      },
    },
  };
});
