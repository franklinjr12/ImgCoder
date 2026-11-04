import { defineConfig } from '@game-artisan/runtime';

export default defineConfig({
  entry: 'src/index.tsx',
  outDir: 'dist',
  assetsDir: 'assets',
  // Press Start 2P ships with @game-artisan/fonts (bundled); add project fonts here if needed.
  fonts: { files: [], dirs: [] },
  defaultFormat: 'png',
  scale: 1,
  locales: ['en', 'de', 'ja'],
  defaultLocale: 'en',
  includeBuiltinTemplates: false,
});
