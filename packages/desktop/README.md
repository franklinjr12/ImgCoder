# @game-artisan/desktop

Electron shell for GameArtisan Studio with native access to a game project's folder.
Assets changed on disk (e.g. re-exported from Aseprite/Photoshop) reload on the canvas automatically.

```bash
pnpm approve-builds        # allow electron's postinstall to download its binary (first time)
pnpm --filter @game-artisan/desktop start -- /path/to/game-project
```

`electron` is an optional dependency so headless/CI-free installs stay light.
