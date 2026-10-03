import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { buildManifest, TARGETS, type Target } from './scripts/manifest.ts';

const target = (process.env.TARGET ?? 'firefox') as Target;
if (!TARGETS.includes(target)) throw new Error(`TARGET must be one of ${TARGETS.join(', ')}`);
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

/** Writes manifest.json for the target browser into the build. */
const manifest = (): Plugin => ({
  name: 'manifest',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'manifest.json', source: JSON.stringify(buildManifest(target, version), null, 2) });
  },
});

export default defineConfig({
  plugins: [react(), manifest()],
  base: './',
  define: { __BROWSER__: JSON.stringify(target) },
  build: {
    outDir: `dist/${target}`,
    emptyOutDir: true,
    target: target === 'chrome' ? 'chrome116' : 'firefox140',
    chunkSizeWarningLimit: 2000,
    rollupOptions: { input: { sidebar: 'sidebar.html' } },
  },
});
