import { defineConfig } from '@game-artisan/runtime';

export default defineConfig({
  entry: 'src/index.tsx',
  outDir: 'dist',
  assetsDir: 'assets',
  fonts: {
    // Add a bold CJK face for crisper Japanese / Korean / Chinese taglines, e.g.:
    // files: [{ path: 'fonts/NotoSansCJKjp-Bold.otf', family: 'Noto Sans CJK JP', weight: 700, locales: ['ja'], fallback: true }],
    files: [],
    dirs: [],
  },
  defaultFormat: 'png',
  scale: 1,
  locales: ['en', 'de', 'es', 'fr', 'pt-BR', 'ja', 'ko', 'zh-CN'],
  defaultLocale: 'en',
  includeBuiltinTemplates: false,
});
