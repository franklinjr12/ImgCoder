# GameArtisan

**Dual-engine marketing-asset generator for video games** — write templates as code (Remotion-style
TSX), edit them visually (Canva-style Studio), and render them headlessly from the CLI, a REST
service or AI agents over MCP. Built for Steam / Itch.io / Epic / console / social store art:
capsule grids, localized title logos, review badges, laurels and safe zones.

```
 TSX template (<Composition/>) ─┐                      ┌─ Studio canvas (same SVG, live)
 Studio design (.artisan.json) ─┼─► UDM artboard ─► SVG ┼─ resvg → PNG → sharp (WebP/JPEG/AVIF)
 Agent / CLI props ($overrides)─┘                      ├─ vector PDF (svg-to-pdfkit)
                                                       └─ headless Chromium (HTML/WebGL compositions)
```

Everything flows through one **Unified Declarative Document Model (UDM)** and one isomorphic SVG
emitter, so the Studio canvas and the CLI output match by construction (text is outlined with
bundled fonts; every effect is an SVG filter). See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
and the original [product backlog](docs/product-backlog.md).

## Quick start

```bash
pnpm install
pnpm build            # turbo: builds all packages
pnpm test             # builds what tests need, then runs vitest locally
```

Render a built-in Steam capsule (no assets needed):

```bash
pnpm artisan list --builtins
pnpm artisan render steam-main-capsule --builtins --props='{"title":"NEON HORIZON"}' --scale=2 --out=out/main@2x.png
```

Start a project of your own:

```bash
npx game-artisan init my-game-marketing && cd my-game-marketing
npm install
npx artisan render key-art --out=out/key-art.png
npx artisan studio
```

## Writing templates

```tsx
import { Composition, Layer, Text, VectorImage, Shadow, registerRoot, zColor, zImage, z } from '@game-artisan/core';

export const Schema = z.object({
  gameTitle: z.string().default('CHRONO BLADE'),
  heroImageUrl: zImage('assets/hero.png'),        // → asset picker in the Studio
  accentColor: zColor('#FF3366'),                  // → colour picker
  heroX: z.number().default(420),
});

function SteamMainCapsule(p: z.infer<typeof Schema>) {
  return (
    <div style={{ width: 616, height: 353, backgroundColor: '#0a0a0c', fontFamily: 'Cinzel, Inter' }}>
      <Layer.Image src="assets/bg.png" width={616} height={353} style={{ filter: 'contrast(1.15) brightness(0.85)' }} />
      <Layer.Gradient type="linear" angle={180} colors={['transparent', 'rgba(5,5,8,.95)']} stops={[0.5, 1]} />
      <Layer.Image id="hero" src={p.heroImageUrl} x={p.heroX} y={10} height={340}
                   bind={{ x: 'heroX' }} effects={[Shadow.glow(p.accentColor, { blur: 30 })]} />
      <div style={{ position: 'absolute', left: 24, bottom: 24, maxWidth: 380 }}>
        <Text content={p.gameTitle} fit="shrink" style={{ fontSize: 34, fontWeight: 900, color: '#fff' }} />
      </div>
    </div>
  );
}

registerRoot(() => (
  <Composition id="steam-main-capsule" width={616} height={353}
               component={SteamMainCapsule} schema={Schema} defaultProps={{}} />
));
```

* Layout is CSS-like flexbox (Yoga); `position: absolute`, `left/right/top/bottom`, `%` sizes,
  padding/margin/gap all work. Plain `div`/`span`/`img` are supported too.
* Primitives: `Layer.Image`, `Layer.Gradient`, `Layer.Group`, `Layer.Rect/Ellipse/Polygon/Star/Path/Line`,
  `Text`, `VectorImage`, `Layer.Halftone`, `Layer.Pattern`, `Layer.Mask`, `Layer.Boolean`.
* Effects: drop/inner shadow, outer glow, rim light, outline, silhouette; adjustments: exposure,
  contrast, saturation, temperature, vignette, bloom, pixelate, posterize, GameBoy palette, duotone,
  chromatic aberration, scanlines, noise; presets `cinematic-dark`, `vibrant-arcade`,
  `grimdark-retro`, `anime-cel`, `crt-arcade`, `gameboy`.
* `bind={{ x: 'heroX' }}` makes canvas drags in the Studio update props (two-way sync); any other
  layer edit is stored as `$overrides` in the props JSON, which every renderer honours.
* Localization: `resolveLocale(localeMap)` + `--locale ja`; CJK glyphs fall back per character to
  locale-preferred fonts (project fonts or system CJK fonts).

## CLI (`artisan`)

| command | purpose |
| --- | --- |
| `artisan list [--json]` | compositions, sizes, props |
| `artisan inspect <id> [--full]` | JSON Schema of the props |
| `artisan render <id \| file.artisan.json> --props='{…}' --out=x.png [--scale 2] [--format webp] [--locale ja] [--renderer chromium]` | render one asset (PNG/JPEG/WebP/AVIF/SVG/PDF) |
| `artisan batch --data=languages.json --compositions=all --out=dist/ [-j 4] [--scales 1,2]` | locale × composition matrix on a worker pool with progress + report |
| `artisan studio` | visual editor for the project |
| `artisan serve --port=4000` | HTTP microservice: `POST /render`, `GET /health`, `POST /rpc`, `/mcp` |
| `artisan mcp [--transport stdio\|sse\|http]` | MCP server for AI agents |
| `artisan agent:matrix <id> -g "goal" [--provider anthropic\|heuristic\|command]` | A/B variants + `contact-sheet.png` |
| `artisan init`, `presets`, `validate`, `schema`, `bench` | scaffolding & utilities |

Config lives in `artisan.config.ts` (`defineConfig` from `@game-artisan/runtime`): `entry`,
`documents`, `assetsDir`, `outDir`, `fonts`, `defaultFormat`, `scale`, `locales`, `server`, …

## Visual Studio

`artisan studio` (or `pnpm studio` for the standalone editor with built-in templates) opens a
Canva-style editor: pan/zoom 10–3200 %, rulers, smart snapping, 8-handle gizmos with rotate/skew,
layer tree (group, lock, clipping masks, drag-reorder), Props Inspector generated from the Zod
schema, layer/effect/grading inspectors, IndexedDB asset library, Steam safe-zone and store-UI
overlays. Code templates are edited through props and `$overrides` (bound layers update props);
"Detach to design" turns any template into a freely editable `.artisan.json` design. Template
edits hot-reload without losing props, and assets changed on disk refresh automatically.

## AI agents (MCP)

```jsonc
// Claude Desktop / Claude Code / Cursor MCP config
{ "mcpServers": { "game-artisan": { "command": "npx", "args": ["artisan", "mcp"], "cwd": "/path/to/project" } } }
```

Tools: `artisan_list_compositions` (alias `list_templates`), `get_template_props` (with PNG thumbnail),
`update_template_props` (validated; persisted in `.artisan/state.json`), `artisan_render`
(alias `render_asset`), `artisan_batch_localize`. The same tools are exposed as JSON-RPC 2.0 on
`POST /rpc` of `artisan serve`.

`artisan agent:matrix` uses Claude (`claude-opus-5-5`, structured outputs, server-side refusal
fallback enabled) when `ANTHROPIC_API_KEY` (or an `ant auth login` profile) is available; use
`--provider heuristic` for an offline, deterministic generator or `--provider command --command "…"`
to plug in any other agent (JSON on stdin/stdout).

## Packages

| package | |
| --- | --- |
| `@game-artisan/core` | UDM schemas, JSX compiler, text engine, SVG emitter (browser + Node) |
| `@game-artisan/fonts` | bundled OFL fonts |
| `@game-artisan/renderer-svg` | resvg/sharp/PDF pipeline, asset & font loading, image compare |
| `@game-artisan/renderer-chromium` | Playwright pool for HTML/WebGL compositions and parity checks |
| `@game-artisan/templates-game` | store preset matrix, Steam/Itch/Epic/social templates, badges |
| `@game-artisan/runtime` | config/project loading, render service, batch pool |
| `@game-artisan/agent-sdk` | MCP server, REST/JSON-RPC server, variant generator |
| `@game-artisan/cli` | the `artisan` binary |
| `@game-artisan/studio` | React/Vite visual editor + `startStudio()` |
| `game-artisan` | `npx game-artisan` facade (+ `build:binary` via `bun --compile`) |
| `@game-artisan/desktop` | Electron shell for the Studio |

Examples: [`examples/retro-pixel-rpg`](examples/retro-pixel-rpg) (pixel-art FX) and
[`examples/sci-fi-survivors`](examples/sci-fi-survivors) (multi-language batch bundle).

## Testing

All tests run locally (there is intentionally no CI configuration):

```bash
pnpm test                                  # pretest builds runtime deps, then vitest
npx vitest run packages/core               # a single package
```

Chromium-based tests (renderer parity, Studio e2e) skip automatically when no Chromium is found;
set `ARTISAN_CHROMIUM_PATH` to point at a browser binary.

## License

MIT. Bundled fonts are under the SIL Open Font License (see `packages/fonts/LICENSES`).
