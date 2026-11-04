import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// @ts-ignore — plain ESM JS shared with the programmatic `startStudio()` API
import { artisanStudioPlugin, workspaceAliases, STUDIO_DIR } from './server/plugin.js';

/**
 * GameArtisan Studio. `pnpm --filter @game-artisan/studio dev` runs standalone (built-in
 * templates + designs); `startStudio({ root, entry, ... })` reuses this file and passes the
 * project options inline (`artisan` key, read by the plugin).
 */
export default defineConfig({
  root: STUDIO_DIR,
  plugins: [react(), artisanStudioPlugin()],
  resolve: {
    alias: workspaceAliases() as { find: RegExp; replacement: string }[],
    dedupe: ['react', 'react-dom', 'zod'],
  },
  define: {
    // fontkit & friends (CJS) reference `global`
    global: 'globalThis',
  },
  esbuild: { target: 'esnext' },
  optimizeDeps: {
    entries: ['index.html'],
    esbuildOptions: { target: 'esnext', define: { global: 'globalThis' } },
  },
  build: {
    target: 'esnext',
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 8000,
    sourcemap: false,
  },
  worker: { format: 'es' },
  server: { port: 5173 },
});
