# Lanternmoor — retro pixel-art RPG example

A GameArtisan project showing the retro toolkit: **Press Start 2P** typography, `Filters.retroPixel`
(pixelate + palette reduction, incl. the GameBoy 4-colour palette), CRT / scanline shaders, a vector
**halftone** layer, `rendering="pixelated"` images and the pixel-leaf `Laurel` / `SaleBadge` from
`@game-artisan/templates-game`. All artwork in `assets/` is original SVG pixel art.

| composition | size | notes |
| --- | --- | --- |
| `steam-header` | 460×215 | Steam header capsule |
| `steam-main` | 616×353 | Steam main capsule |
| `steam-main-sale` | 616×353 | sale variant: event strip, pixel laurel, `-40%` ribbon |
| `itch-cover` | 630×500 | itch.io cover |
| `itch-cover-gameboy` | 630×500 | same art reduced to the GameBoy palette |

```bash
pnpm artisan list                                      # list compositions
pnpm artisan render steam-main --out=dist/steam-main.png
pnpm artisan render itch-cover --props='{"palette":"gameboy","pixelSize":3}'
pnpm artisan render steam-main --locale=ja             # localized title / tagline via localeMap
pnpm batch                                             # languages.json × all compositions → dist/
pnpm studio                                            # visual editor
```

Useful props: `palette` (`full`, `16-color`, `gameboy`, `gameboy-pocket`, `cga`, `sepia-4`), `pixelSize`,
`crt`, `crtIntensity`, `halftone`, `discount`, `eventBanner`, `laurelTitle`.

Test (from the repo root): `npx vitest run examples/retro-pixel-rpg`
