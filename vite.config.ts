import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'firefox140',
    chunkSizeWarningLimit: 2000,
    rollupOptions: { input: { sidebar: 'sidebar.html' } },
  },
});
