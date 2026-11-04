import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const pkg = (p: string) => fileURLToPath(new URL(`./packages/${p}`, import.meta.url));

// Tests run against TypeScript sources (no build needed). Everything runs locally: `pnpm test`.
export default defineConfig({
  resolve: {
    alias: [
      { find: /^@game-artisan\/core$/, replacement: pkg('core/src/index.ts') },
      { find: /^@game-artisan\/renderer-svg\/node$/, replacement: pkg('renderer-svg/src/node.ts') },
      { find: /^@game-artisan\/renderer-svg$/, replacement: pkg('renderer-svg/src/index.ts') },
      { find: /^@game-artisan\/renderer-chromium$/, replacement: pkg('renderer-chromium/src/index.ts') },
      { find: /^@game-artisan\/templates-game$/, replacement: pkg('templates-game/src/index.tsx') },
      { find: /^@game-artisan\/runtime$/, replacement: pkg('runtime/src/index.ts') },
      { find: /^@game-artisan\/agent-sdk$/, replacement: pkg('agent-sdk/src/index.ts') },
      { find: /^@game-artisan\/cli$/, replacement: pkg('cli/src/index.ts') },
    ],
  },
  esbuild: { jsx: 'automatic' },
  test: {
    include: ['packages/*/test/**/*.test.{ts,tsx}', 'examples/*/test/**/*.test.{ts,tsx}'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    pool: 'forks',
  },
});
