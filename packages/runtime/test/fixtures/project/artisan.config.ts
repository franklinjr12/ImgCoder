// Plain object config (defineConfig from '@game-artisan/runtime' is optional sugar).
export default {
  entry: 'src/index.tsx',
  documents: ['designs'],
  includeBuiltinTemplates: false,
  outDir: 'out',
  assetsDir: 'assets',
  defaultFormat: 'png' as const,
};
