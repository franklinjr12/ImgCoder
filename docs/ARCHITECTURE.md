# GameArtisan architecture

GameArtisan is a dual-engine (code + visual) marketing-asset generator for games. Everything
revolves around the **Unified Declarative Document Model (UDM)**: a JSON-serialisable layer tree
that the CLI renderers, the Studio and the agent tooling all operate on.

```
 TSX template (<Composition/>)  ──compileComposition──┐
 Studio design (UDM JSON, $prop bindings) ────────────┤──►  UDM Artboard  ──renderArtboardToSvg──►  SVG
 Agent / CLI props JSON ($overrides, $locale) ────────┘                                              │
                                                     ┌───────────────────────────────────────────────┤
                                     Studio canvas (inline SVG)      resvg → PNG → sharp (WebP/JPEG/AVIF)
                                                                     svg-to-pdfkit (vector PDF)
                                                                     Chromium (html compositions, parity)
```

The *same* isomorphic emitter (`@game-artisan/core` → `renderArtboardToSvg`) produces the SVG shown
in the Studio and the SVG rasterised by the CLI, so the two match by construction. Text is converted
to glyph outlines with fontkit (no system fonts involved) and every effect is an SVG filter, so resvg,
Chromium and the browser agree.

## Packages

| package | role |
| --- | --- |
| `@game-artisan/core` | UDM zod schemas, tree utils, variables, serialization, JSON-schema export, matrix/path math, colour, font registry + text layout (fontkit), asset resolver interface, JSX primitives + compiler (Yoga flexbox), composition registry, overrides, effect presets, SVG emitter. Browser + Node safe. |
| `@game-artisan/fonts` | Bundled OFL fonts (Inter 400/400i/700/900, Cinzel 400/700/900, Bebas Neue, Press Start 2P) + `loadBundledFonts()` (fs in Node, fetch in browser). |
| `@game-artisan/renderer-svg` | `.` = isomorphic helpers (`renderCompositionToSvg`, `svgToDataUri`). `./node` = resvg rasteriser, sharp encoders, PDF export, `NodeAssetResolver` (fs/http + disk cache), `createNodeFontRegistry` (bundled + project + system CJK fallback), `renderComposition`, `compareImages`, `contactSheet`. |
| `@game-artisan/renderer-chromium` | Playwright-core pool; renders `kind: 'html'` compositions and UDM SVG in Chromium at any DPR; asset caching via request interception. |
| `@game-artisan/templates-game` | `STORE_PRESETS` matrix, Steam/Itch/Epic/console/social templates, badges/laurels/sale tags/age-rating blocks, localisation helpers. |
| `@game-artisan/runtime` | Node orchestration: `artisan.config.ts` loading, TSX entry bundling (esbuild), `ArtisanProject`, render-to-file service, batch worker pool, localisation matrix. |
| `@game-artisan/agent-sdk` | MCP server (stdio + SSE/Streamable HTTP), REST/JSON-RPC server, A/B variant generator. |
| `@game-artisan/cli` | `artisan` binary (commander). |
| `@game-artisan/studio` | Vite + React WYSIWYG editor + `startStudio()` dev-server API. |
| `game-artisan` | npx facade (`npx game-artisan render ...`). |
| `@game-artisan/desktop` | Electron shell around the Studio with project-folder access. |

## Core API cheat-sheet (`@game-artisan/core`)

```ts
// UDM
type Layer = VectorLayer | RasterLayer | TextLayer | SvgLayer | HalftoneLayer | PatternLayer | GroupLayer | MaskLayer | BooleanLayer
interface Artboard { id; name?; width; height; background?: Fill; children: Layer[]; safeZones: SafeZone[]; guides: Guide[]; preset?; locale? }
interface ArtisanDocument { kind:'artisan-document'; version:1; id; name; artboards: Artboard[]; props?: { schema: JSONSchema; defaults }; fonts: FontFace[] }
// every layer: { id, name?, type, visible, locked, opacity, blendMode, transform:{x,y,width,height,rotation,scaleX,scaleY,skewX,skewY,originX,originY,flipX?,flipY?}, effects: Effect[], adjustments: Adjustment[], clippingMask, bindings?: Record<fieldPath, propName>, meta? }
createLayer(type, partial) / createArtboard / createDocument      // fill defaults via zod
LayerSchema / ArtboardSchema / DocumentSchema / TextStyleSchema / FillSchema / EffectSchema / AdjustmentSchema (zod)
serializeDocument(doc) / deserializeDocument(json) / validateDocument / getUdmJsonSchema()
resolveDocumentVariables(doc, props)       // { "$prop": "title" } bindings → values; records layer.bindings
walkLayers / findLayer / flattenLayers / mapLayers / updateLayer / removeLayers / computeWorldMatrices / layerWorldBounds / selectionBounds / generateId / cloneDeep
transformToMatrix(t) / multiply / invert / applyToPoint / decompose / transformRect   // 2x3 affine, T·R·K·S about origin
PathBuilder / parsePath / pathBounds / rectPath / ellipsePath / polygonPath / starPath
parseColor / svgColor / toHex / contrastRatio

// Fonts & text
const fonts = new FontRegistry(); fonts.register(bytes, { family?, weight?, style?, locales?, fallback? });
layoutText(content, style, fonts, { maxWidth, locale }) / layoutToPath / measureText

// Assets
interface AssetResolver { resolve(src): Promise<{ href, mime, width?, height?, data?, text? }> }
new CachingAssetResolver(loader) / fetchLoader(base) / assetFromBytes(bytes, mime) / placeholderAsset()

// JSX primitives (inert markers, compiled like Satori — no hooks)
<Layer.Image src fit position rendering cornerRadius />  <Layer.Gradient type angle colors stops cx cy radius />
<Layer.Group fill clip>…</Layer.Group>  <Layer.Rect|Ellipse|Polygon|Star|Path|Line fill stroke strokes />
<Text content fill strokes fit maxLines />  <VectorImage src|markup fill />  <Layer.Halftone/> <Layer.Pattern/> <Layer.Mask mask={…}/> <Layer.Boolean operation/>
common props: id, name, style (CSS subset + Yoga flexbox), x, y, width, height, rotation, scale, opacity, blendMode, hidden, locked, effects, adjustments, clippingMask, bind={{ x:'heroX' }}
plain div/span/p/h1/img also work (style → layout/paint). Text styles inherit like CSS.

// Compositions
<Composition id width height component schema defaultProps kind? preset? platform? tags? safeZones? defaultFormat? /> ; <Folder name>
registerRoot(() => <>…</>) / registerCompositions(def…) / getCompositions() / getComposition(id) / defineComposition / compositionFromDocument(doc)
describeComposition(def) → { id, name, width, height, kind, propsSchema (JSON Schema), defaultProps, safeZones, … }
resolveProps(def, input) (throws PropsValidationError with agent-friendly issues)
compileComposition(def, { fonts, assets, props, overrides, locale }) → { artboard, props }
props payload meta keys: `$overrides` (LayerOverrides: { [layerId]: { transform?, visible?, opacity?, content?, style?, … } }), `$locale`
applyOverrides / mergeOverrides ; getRenderContext() / getLocale() / resolveLocale(map, locale)
zColor() zImage() zSvg() zFont() zSlider(min,max) zLongText() zLocaleMap(v)   // JSON-schema "x-artisan-widget" hints for the Props Inspector

// Effects
GRADING_PRESETS ('cinematic-dark','vibrant-arcade','grimdark-retro','anime-cel','crt-arcade','gameboy'), Filters.*, Shadow.drop/inner/glow/rimLight/outline/silhouette

// Output
renderArtboardToSvg(artboard, { fonts, assets, scale, textMode:'outline'|'text', idPrefix, annotate, locale }) → { svg, width, height, warnings }
// emitted layers are <g id="{prefix}-L-{id}" data-layer-id data-layer-type transform="matrix(…)">
documentToTemplateCode(doc) / propsToJson(props, overrides) / compositionCode(...) / diffProps(a, b)
```

## Conventions

* ESM everywhere, TypeScript strict, `tsup` builds (`pnpm build` via turbo).
* Tests: `vitest` from the repo root (`pnpm test`), tests live in `packages/<pkg>/test/*.test.ts(x)` and
  import workspace packages by name (aliased to sources in `vitest.config.ts`). Tests that need Chromium
  skip automatically when no browser is available. **No CI config** — tests are run locally.
* Bundled fonts only (no system font dependency) except optional CJK fallback discovered from the OS.
