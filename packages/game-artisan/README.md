# game-artisan

One-command entry point for GameArtisan.

```bash
npx game-artisan init my-game-marketing
npx game-artisan list
npx game-artisan render steam-header-capsule --props='{"title":"NEON HORIZON"}' --out=out/header.png --scale=2
```

Standalone binary (no Node.js required on the target machine), built with Bun:

```bash
pnpm --filter game-artisan build:binary   # → packages/game-artisan/bin/artisan
```
