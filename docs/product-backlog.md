# Project Specification & Engineering Backlog: GameArtisan (Dual-Engine Marketing Asset Generator)

**Version:** 1.0.0  
**Target Environment:** Node.js / Bun / Browser (Web & Desktop)  
**Primary Target Domain:** Video Game Marketing (Steam, Itch.io, Epic Games Store, Consoles, Social Media)  
**Architecture Paradigm:** Declarative Code-as-Canvas (Remotion-inspired) + Interactive WYSIWYG Canvas (Canva-inspired)

---

## 1. Architectural Research & Technical Blueprint

### 1.1 Comparative Analysis & Inspiration Mapping

| Dimension | Canva | Remotion | GameArtisan (Our Engine) |
| :--- | :--- | :--- | :--- |
| **Primary Paradigm** | Interactive WYSIWYG canvas (drag, drop, click). | Code-first declarative components (React/TSX). | **Hybrid:** Declarative TSX/JSX & JSON-AST with live two-way visual editing. |
| **Execution Surface** | Browser WebGL / Canvas2D / DOM. | Headless Chrome (Puppeteer) CLI / Local Studio server. | **Dual Surface:** Headless CLI (CI/CD, AI Agents) + Web/Desktop Visual Studio. |
| **Target Output** | Static graphics & print PDF. | Frame-by-frame MP4/WebM videos and audio. | **Multi-Format Static:** High-res raster (PNG, WebP, JPEG) & Vector (SVG, PDF). |
| **Automation** | Limited (Enterprise API / Canva Apps SDK). | Complete CLI automation (`npx remotion render`). | **Agent-Native:** JSON Schema/Zod validation, headless CLI, batch rendering, MCP server. |
| **Domain Specialization**| General social media, corporate, marketing. | General motion graphics, code videos. | **Game Marketing:** Steam capsule grids, localized title logos, review badges, safe zones. |

### 1.2 Rendering Pipeline Architecture

To achieve both CLI headless rendering and interactive UI manipulation without maintaining two separate graphics engines, GameArtisan uses a **Unified Declarative Document Model (UDM)**:

```
                          ┌───────────────────────────┐
                          │   AI Agent / Script CLI   │
                          │  (Dynamic Props / TSX)    │
                          └─────────────┬─────────────┘
                                        │
                                        ▼
┌───────────────────────────┐     ┌───────────┐     ┌───────────────────────────┐
│     Human Designer        │───▶ │  UDM AST  │ ◀───│   Local TSX Template      │
│ (WYSIWYG Canvas Studio)   │     │ (JSON/Zod)│     │   (React / JSX Components)│
└───────────────────────────┘     └─────┬─────┘     └───────────────────────────┘
                                        │
            ┌───────────────────────────┴───────────────────────────┐
            ▼                                                       ▼
┌───────────────────────┐                               ┌───────────────────────┐
│     Studio UI         │                               │     Headless CLI      │
│ • WebGL/Canvas2D Host │                               │ • Resvg-js (Fast SVG) │
│ • Live Props Inspector│                               │ • Chromium Headless   │
│ • Drag/Drop Gizmos    │                               │ • Sharp / Skia Engine │
│ • Safe Zone Overlays  │                               │ • Multi-core Parallel │
└───────────────────────┘                               └───────────────────────┘
            │                                                       │
            ▼                                                       ▼
[Real-time Interactive Canvas]                            [Production Artworks]
                                                          • Steam Assets Kit
                                                          • Itch.io / Epic Banners
                                                          • Localized Vector Logos
                                                          • Ultra HD Press Assets
```

#### Dual Renderer Engine Strategy:
1. **Lightweight Vector Pipeline (Resvg + Satori/Yoga + Sharp):**
   - For fast, sub-second vector rendering (SVG, PDF, text layouts, localized banners).
   - Generates pixel-perfect SVG using SVG AST or JSX Flexbox, then compiles via Rust-based `@resvg/resvg-js`.
2. **Full DOM / WebGL Pipeline (Headless Chromium / Puppeteer):**
   - For complex effects: custom CSS blend modes, drop-shadows, complex shaders, canvas particle overlays, and 3D mockups.
   - Mirrors Remotion’s architecture: boots headless Chrome, injects composition props, snapshots the canvas at device pixel ratio $2\times$ or $4\times$.

---

## 2. Monorepo Structure

```
game-artisan/
├── packages/
│   ├── core/                  # UDM AST, Schema parser, Zod definitions, math, transforms
│   ├── renderer-svg/          # Ultra-fast SVG/Resvg/Sharp headless renderer
│   ├── renderer-chromium/     # Chrome/Puppeteer pipeline for DOM/WebGL fidelity
│   ├── studio/                # React-based Canva-like visual editor & component inspector
│   ├── cli/                   # Commander-based CLI tool (`artisan render`, `artisan init`)
│   ├── agent-sdk/             # MCP server & JSON-RPC tools for AI Agent orchestration
│   └── templates-game/        # Production-ready Steam, Itch, Epic, and Social templates
├── examples/
│   ├── retro-pixel-rpg/       # Sample game asset project
│   └── sci-fi-survivors/      # Multi-language localization asset bundle
├── package.json
└── turbo.json
```

---

## 3. Product Backlog Overview

- **Epic 1: Core Foundation & Declarative Document Model (UDM)**
- **Epic 2: Headless CLI Engine & Multi-Format Exporter**
- **Epic 3: Interactive Canva-like WYSIWYG Visual Studio**
- **Epic 4: Bidirectional Synchronization (Code $\leftrightarrow$ Canvas)**
- **Epic 5: Game Marketing Domain Specialization & Template Kit**
- **Epic 6: AI Agent Protocol, MCP Server & Automation API**
- **Epic 7: Advanced Image Processing, Shaders & Vector Operations**
- **Epic 8: Packaging, Distribution & Extensibility**

---

## 4. Epics & User Stories

### Epic 1: Core Foundation & Declarative Document Model (UDM)

#### US-1.1: Unified Document Model (AST) Specification
- **Description:** As an engine architect, I need a deterministic JSON-serializable AST that defines layers, vectors, typography, effects, and dynamic props so that both the CLI and UI operate on identical data structures.
- **Acceptance Criteria:**
  - Define TypeScript types and Zod schemas for `Artboard`, `Layer` (Vector, Raster, Text, Group, Mask), `Transform`, `Filter`, `BlendMode`, and `VariableProp`.
  - Support nested tree hierarchy with coordinate space inheritance.
  - Implement zero-dependency serialization and deserialization functions with JSON schema export.
- **Priority:** P0 | **Story Points:** 5

#### US-1.2: Declarative Composition API (Remotion-like TSX Wrapper)
- **Description:** As a developer, I want to declare compositions in React/TSX using a `<Composition />` component with typed `defaultProps` and Zod validation.
- **Acceptance Criteria:**
  - Provide `<Composition id="SteamHeader" width={460} height={215} schema={PropSchema} defaultProps={...} component={SteamHeaderComponent} />`.
  - Provide a registry system (`registerRoot()`) to collect and expose all available templates to both CLI and UI.
  - Ensure hot-module reloading (HMR) triggers without losing current props.
- **Priority:** P0 | **Story Points:** 5

#### US-1.3: Vector Engine Core (SVG Primitive Tree)
- **Description:** As a creator, I want first-class vector primitives (Paths, Bézier curves, Polygons, Boolean operations) so vector art remains crisp at any DPI.
- **Acceptance Criteria:**
  - Abstract path builder supporting SVG path syntax (`d="..."`).
  - Support vector fills (solid, linear gradient, radial gradient) and vector strokes (dash, cap, join).
  - Implement bounding-box calculation and matrix transformations ($2 \times 3$ affine transform).
- **Priority:** P0 | **Story Points:** 8

---

### Epic 2: Headless CLI Engine & Multi-Format Exporter

#### US-2.1: CLI Command Line Interface Structure
- **Description:** As a developer or AI agent, I want a robust CLI binary (`artisan`) to list, inspect, and render graphic templates without opening a browser.
- **Acceptance Criteria:**
  - `artisan list` lists all registered compositions, dimensions, and accepted props schemas.
  - `artisan inspect <composition-id>` outputs JSON Schema of dynamic props.
  - `artisan render <composition-id> --props='{...}' --out=output.png` renders output.
  - Support config file (`artisan.config.ts`).
- **Priority:** P0 | **Story Points:** 5

#### US-2.2: Fast Vector Headless Renderer (Resvg + Satori)
- **Description:** As an agent runner, I want sub-second renders for high-volume vector/raster marketing variations without the overhead of booting a full browser.
- **Acceptance Criteria:**
  - Implement headless pipeline: JSX/AST $\to$ SVG string $\to$ `@resvg/resvg-js` $\to$ PNG Buffer.
  - Support web fonts and local TTF/OTF/WOFF2 font loading without system dependencies.
  - Benchmarked render time: $< 200\text{ ms}$ for standard $1232 \times 706$ capsule.
- **Priority:** P1 | **Story Points:** 8

#### US-2.3: Chromium Headless Renderer for Complex Graphic Pipelines
- **Description:** As an artist, I want to render templates utilizing WebGL shaders, SVG filters, canvas blend modes, and CSS backdrops via headless browser.
- **Acceptance Criteria:**
  - Integrate Playwright or Puppeteer-core with pre-warmed browser pool.
  - Render at arbitrary pixel density multipliers (`--scale=1`, `--scale=2`, `--scale=4`) for high-DPI print/storefronts.
  - Implement asset caching to prevent re-fetching external graphics across batch runs.
- **Priority:** P1 | **Story Points:** 8

#### US-2.4: Multi-Format Exporters (Vector & Raster)
- **Description:** As a marketer, I want output in PNG, WebP, JPEG, SVG, and vector PDF formats.
- **Acceptance Criteria:**
  - Lossless and lossy WebP compression options via `sharp`.
  - Scalable vector export as clean standalone `.svg` with inlined or linked fonts.
  - Vector `.pdf` export compatible with store press-kit guidelines.
- **Priority:** P0 | **Story Points:** 5

#### US-2.5: Batch & Matrix Localization Rendering
- **Description:** As a game producer, I want to render 30 localized language variations across 6 Steam capsule sizes in a single CLI command.
- **Acceptance Criteria:**
  - Command: `artisan batch --data=languages.json --compositions=all --out=dist/`.
  - Multi-threaded worker pool rendering across CPU cores.
  - Real-time progress bar with per-item timing metrics and error recovery.
- **Priority:** P1 | **Story Points:** 5

---

### Epic 3: Interactive Canva-like WYSIWYG Visual Studio

#### US-3.1: Visual Studio Canvas Shell & Viewport
- **Description:** As an artist, I want an interactive web/desktop canvas viewport with pan, zoom ($10\% - 3200\%$), pixel-grid snapping, and dynamic artboard switching.
- **Acceptance Criteria:**
  - Infinite pan/zoom canvas powered by HTML5 Canvas or WebGL (Pixi.js / Konva / custom renderer).
  - High frame rate ($60\text{ fps}$) transformation of selected layers.
  - Display ruler bars, pixel coordinate indicators, and customizable snapping guides.
- **Priority:** P0 | **Story Points:** 8

#### US-3.2: Layer Hierarchy & Management Panel
- **Description:** As a designer, I want a layer tree panel to reorder, rename, group, lock, hide, and mask graphic elements.
- **Acceptance Criteria:**
  - Drag-and-drop layer reordering (affects z-index).
  - Grouping (`Ctrl+G`) and ungrouping (`Ctrl+Shift+G`).
  - Lock layer to prevent accidental canvas manipulation.
  - Clipping mask support (mask one layer using the alpha channel of the layer below).
- **Priority:** P0 | **Story Points:** 5

#### US-3.3: Interactive On-Canvas Bounding Box & Transformation Gizmos
- **Description:** As an artist, I want direct visual bounding boxes to scale, rotate, skew, and reposition elements with mouse/trackpad.
- **Acceptance Criteria:**
  - 8-point resize handles maintaining or ignoring aspect ratio (with `Shift` toggle).
  - Circular rotation handle with $15^\circ$ snap increments when holding `Shift`.
  - Multi-selection bounding box for collective translation and scaling.
- **Priority:** P0 | **Story Points:** 8

#### US-3.4: Typography & Text Styling Engine
- **Description:** As a game marketer, I want rich text styling for game titles, callouts, and sale badges.
- **Acceptance Criteria:**
  - Support custom web font and local font uploads (.ttf, .otf, .woff2).
  - Advanced typographical controls: letter-spacing (tracking), line-height, text alignment, uppercase toggle.
  - Multi-stroke outlines (essential for video game logos and comic styles).
  - Drop shadow, inner shadow, and gradient fill for text glyphs.
- **Priority:** P0 | **Story Points:** 8

#### US-3.5: Asset Library & Media Manager
- **Description:** As an artist, I want an integrated media tray to drag and drop game screenshots, key art, transparent PNG character cutouts, and logos onto the canvas.
- **Acceptance Criteria:**
  - Drag-and-drop file import directly onto canvas or asset panel.
  - Category tagging: Backgrounds, Characters, Logos, Badges, Overlays.
  - Integrated local file storage or IndexedDB persistence for offline-first usage.
- **Priority:** P1 | **Story Points:** 5

---

### Epic 4: Bidirectional Synchronization (Code $\leftrightarrow$ Canvas)

#### US-4.1: Live Props Inspector Panel (Auto-generated from Zod Schema)
- **Description:** As an artist, I want an inspector UI that automatically displays form controls matching the template's Zod prop types.
- **Acceptance Criteria:**
  - Zod `string` renders text input; `number` renders slider/number field; `color` renders color picker; `enum` renders dropdown; `image` renders asset picker.
  - Modifying an input in the inspector instantly triggers re-render of canvas.
  - Reset to default props button.
- **Priority:** P0 | **Story Points:** 5

#### US-4.2: Visual Edits to Props/Code Sync Engine
- **Description:** As a developer, I want changes made on the visual canvas (e.g., repositioning a layer) to update the component props or export back to clean JSON/JSX.
- **Acceptance Criteria:**
  - Direct canvas manipulation of an exposed prop updates the state in real-time.
  - "Copy as Props JSON" and "Export Template Code" buttons generating valid TypeScript code.
  - Warning indicator when canvas state deviates from programmatic defaults.
- **Priority:** P1 | **Story Points:** 8

---

### Epic 5: Game Marketing Domain Specialization & Template Kit

#### US-5.1: Steam Storefront Asset Presets with Official Guidelines
- **Description:** As an indie game developer, I want pre-configured templates for all official Steam graphical assets with built-in safe zones.
- **Acceptance Criteria:**
  - Presets included with exact specifications:
    * **Header Capsule:** $460 \times 215\text{ px}$
    * **Small Capsule:** $231 \times 87\text{ px}$
    * **Main Capsule:** $616 \times 353\text{ px}$
    * **Vertical Capsule:** $374 \times 448\text{ px}$
    * **Page Background:** $1438 \times 810\text{ px}$
    * **Community Icon:** $32 \times 32\text{ px}$ / $184 \times 184\text{ px}$
    * **Library Hero:** $3840 \times 1240\text{ px}$ (with Steam client safe zone overlay)
    * **Library Capsule:** $600 \times 900\text{ px}$
    * **Library Logo:** $1280 \times 720\text{ px}$ (transparent PNG with anchor placement)
  - Toggleable visual overlay for Steam UI dark gradients and title safe zones.
- **Priority:** P0 | **Story Points:** 5

#### US-5.2: Alternative Storefronts & Social Media Preset Matrix
- **Description:** As a multi-platform publisher, I want templates for Itch.io, Epic Games Store, Nintendo Switch eShop, PlayStation Store, and social media announcements.
- **Acceptance Criteria:**
  - Itch.io Banner ($960 \times 400$) and Game Cover ($630 \times 500$).
  - Epic Games Store Portrait ($1200 \times 1600$), Landscape ($2560 \times 1440$).
  - Twitch Stream Overlay ($1920 \times 1080$), Twitter/X Promo Card ($1200 \times 675$), Discord Announcement Banner.
- **Priority:** P1 | **Story Points:** 3

#### US-5.3: Game Badges, Accolades & Rating System Component
- **Description:** As a marketer, I want drop-in vector badges for awards, review quotes ("10/10 - IGN"), "Demo Available", and festival laurels.
- **Acceptance Criteria:**
  - Configurable Laurel component: custom festival text, customizable leaf styles, year.
  - Sale Badge component: customizable percentage tag (e.g., "-50%"), wishlist callout.
  - ESRB / PEGI / USK age rating placeholder layout blocks.
- **Priority:** P1 | **Story Points:** 5

#### US-5.4: Multi-Language Title Swap and Font Fallback System
- **Description:** As a developer publishing in Asia, I want the template to swap English game logos for localized Chinese, Japanese, or Korean vector logos based on target locale.
- **Acceptance Criteria:**
  - Define `localeMap` prop: dynamically resolves title logo image or localized vector font based on `--locale` argument.
  - Intelligent CJK font fallback when rendering dynamic text strings.
- **Priority:** P1 | **Story Points:** 5

---

### Epic 6: AI Agent Protocol, MCP Server & Automation API

#### US-6.1: Model Context Protocol (MCP) Server Integration
- **Description:** As an AI agent (e.g., Claude, Cursor, AutoGPT), I want an MCP server exposing GameArtisan tools so I can discover, edit, and render marketing assets directly.
- **Acceptance Criteria:**
  - Implement MCP tools:
    * `list_templates`: Returns IDs, sizes, and JSON Schema of props.
    * `get_template_props`: Retrieves current props and preview thumbnails.
    * `update_template_props`: Modifies copy, colors, character assets.
    * `render_asset`: Generates PNG/SVG and returns local file path or base64.
  - Follow official `@modelcontextprotocol/sdk` standard over stdio and SSE.
- **Priority:** P0 | **Story Points:** 8

#### US-6.2: JSON-RPC & Headless REST Server Mode
- **Description:** As an automation engineer, I want to run `artisan serve --port=4000` to expose a microservice for remote image generation workflows.
- **Acceptance Criteria:**
  - Lightweight HTTP server with `POST /render` accepting template ID, target format, scale, and props payload.
  - Rate limiting, health check (`GET /health`), and worker queue management for high-load environments.
- **Priority:** P1 | **Story Points:** 5

#### US-6.3: Agent Generative Layout Assistance (A/B Test Variant Generator)
- **Description:** As an agent, I want to submit high-level marketing goals (e.g., "Make 10 variations emphasizing the character vs the action screenshot") and receive rendered asset variations.
- **Acceptance Criteria:**
  - CLI script `artisan agent:matrix` that takes an array of prompt variants, calls agent API to generate prop variations, and renders a side-by-side comparison sheet (`contact-sheet.png`).
- **Priority:** P2 | **Story Points:** 8

---

### Epic 7: Advanced Image Processing, Shaders & Vector Operations

#### US-7.1: Color Grading, Vignette & Contrast Shaders
- **Description:** As an artist, I want non-destructive photographic filters (exposure, contrast, saturation, vignette, bloom/glow) applied to raw game screenshots.
- **Acceptance Criteria:**
  - Shader filters operable in WebGL/Canvas and exported identically in headless renderers.
  - Presets: "Cinematic Dark", "Vibrant Arcade", "Grimdark Retro", "Anime Cel".
- **Priority:** P1 | **Story Points:** 5

#### US-7.2: Vector Halftone, Scanline & Retro Pixel-Art Effects
- **Description:** As a retro game creator, I want scanlines, pixelation grids, and CRT warp effects for authentic game banners.
- **Acceptance Criteria:**
  - Configurable pixelation filter: pixel size parameter, color palette reduction (e.g., 16-color, GameBoy 4-color).
  - SVG halftone dot generator for comic/manga style print marketing.
- **Priority:** P2 | **Story Points:** 5

#### US-7.3: Automatic Alpha-Matte Silhouette & Drop Glow
- **Description:** As a designer, I want to upload a transparent character cutout and automatically generate a colored rim-light, silhouette, or outer glow.
- **Acceptance Criteria:**
  - SVG/Canvas filter calculating dilation of the alpha channel.
  - Configurable glow color, blur radius, opacity, and blend mode.
- **Priority:** P1 | **Story Points:** 5

---

### Epic 8: Packaging, Distribution & Extensibility

#### US-8.1: Standalone CLI Distribution (npx & binary)
- **Description:** As a developer, I want to run `npx game-artisan` without complex environment setup.
- **Acceptance Criteria:**
  - NPM package with executable bin script.
  - Optional standalone binary compilation (via `pkg` or `bun compile`) for environments without Node.js installed.
- **Priority:** P1 | **Story Points:** 3

#### US-8.2: Desktop Studio App (Electron or Tauri)
- **Description:** As a game artist, I want a dedicated desktop app with native file-system access to my game project's asset directory.
- **Acceptance Criteria:**
  - Tauri or Electron bundle for macOS, Windows, and Linux.
  - Auto-reload when assets in the target project folder change on disk.
- **Priority:** P2 | **Story Points:** 8

---

## 5. Game Marketing Preset Matrix Specification

This matrix must be built into `@game-artisan/templates-game` as default constants:

```typescript
export interface StoreAssetSpec {
  id: string;
  platform: 'steam' | 'itch' | 'epic' | 'gog' | 'playstation' | 'switch' | 'social';
  name: string;
  width: number;
  height: number;
  aspectRatio: string;
  requiredFormat: 'png' | 'jpeg' | 'webp' | 'svg';
  maxFileSizeBytes?: number;
  safeZoneMargins?: { top: number; right: number; bottom: number; left: number };
  notes: string;
}

export const STORE_PRESETS: Record<string, StoreAssetSpec> = {
  // Steam Core Capsules
  STEAM_HEADER_CAPSULE: {
    id: 'steam-header-capsule',
    platform: 'steam',
    name: 'Steam Header Capsule',
    width: 460,
    height: 215,
    aspectRatio: '92:43',
    requiredFormat: 'png',
    notes: 'Displayed on search, daily deals, genre lists. Needs game logo + prominent key art.'
  },
  STEAM_MAIN_CAPSULE: {
    id: 'steam-main-capsule',
    platform: 'steam',
    name: 'Steam Main Capsule',
    width: 616,
    height: 353,
    aspectRatio: '616:353',
    requiredFormat: 'png',
    notes: 'Feature carousel placement.'
  },
  STEAM_VERTICAL_CAPSULE: {
    id: 'steam-vertical-capsule',
    platform: 'steam',
    name: 'Steam Vertical Capsule',
    width: 374,
    height: 448,
    aspectRatio: '187:224',
    requiredFormat: 'png',
    notes: 'Featured sales, event promotions, deep discounts.'
  },
  STEAM_SMALL_CAPSULE: {
    id: 'steam-small-capsule',
    platform: 'steam',
    name: 'Steam Small Capsule',
    width: 231,
    height: 87,
    aspectRatio: '77:29',
    requiredFormat: 'png',
    notes: 'Small lists, sidebars. Requires high-contrast title typography readable at micro-sizes.'
  },
  STEAM_PAGE_BACKGROUND: {
    id: 'steam-page-background',
    platform: 'steam',
    name: 'Steam Page Background',
    width: 1438,
    height: 810,
    aspectRatio: '16:9',
    requiredFormat: 'jpeg',
    notes: 'Sides fade softly to black #000000 to match Steam store page framing.'
  },
  STEAM_LIBRARY_HERO: {
    id: 'steam-library-hero',
    platform: 'steam',
    name: 'Steam Library Hero Banner',
    width: 3840,
    height: 1240,
    aspectRatio: '96:31',
    requiredFormat: 'png',
    safeZoneMargins: { top: 100, right: 200, bottom: 400, left: 200 },
    notes: 'Bottom-left has critical safe zone where Steam client overlays logo and play button.'
  },
  STEAM_LIBRARY_CAPSULE: {
    id: 'steam-library-capsule',
    platform: 'steam',
    name: 'Steam Library Vertical Capsule',
    width: 600,
    height: 900,
    aspectRatio: '2:3',
    requiredFormat: 'png',
    notes: 'Player game library grid view.'
  },
  STEAM_LIBRARY_LOGO: {
    id: 'steam-library-logo',
    platform: 'steam',
    name: 'Steam Library Logo Overlay',
    width: 1280,
    height: 720,
    aspectRatio: '16:9',
    requiredFormat: 'png',
    notes: 'Transparent PNG placed over the Library Hero.'
  },

  // Itch.io
  ITCH_COVER: {
    id: 'itch-cover',
    platform: 'itch',
    name: 'Itch.io Game Cover',
    width: 630,
    height: 500,
    aspectRatio: '63:50',
    requiredFormat: 'png',
    notes: 'Main storefront grid card.'
  },
  ITCH_BANNER: {
    id: 'itch-banner',
    platform: 'itch',
    name: 'Itch.io Header Banner',
    width: 960,
    height: 400,
    aspectRatio: '12:5',
    requiredFormat: 'png',
    notes: 'Top of game detail page.'
  },

  // Epic Games Store
  EPIC_LANDSCAPE: {
    id: 'epic-landscape',
    platform: 'epic',
    name: 'Epic Store Landscape',
    width: 2560,
    height: 1440,
    aspectRatio: '16:9',
    requiredFormat: 'jpeg',
    notes: 'Main promotional carousels.'
  },
  EPIC_PORTRAIT: {
    id: 'epic-portrait',
    platform: 'epic',
    name: 'Epic Store Portrait',
    width: 1200,
    height: 1600,
    aspectRatio: '3:4',
    requiredFormat: 'png',
    notes: 'Store catalog tile.'
  },

  // Social & Marketing
  SOCIAL_TWITTER_CARD: {
    id: 'social-twitter-card',
    platform: 'social',
    name: 'Twitter/X Promo Card',
    width: 1200,
    height: 675,
    aspectRatio: '16:9',
    requiredFormat: 'png',
    notes: 'Optimal preview card for game announcements.'
  },
  SOCIAL_DISCORD_BANNER: {
    id: 'social-discord-banner',
    platform: 'social',
    name: 'Discord Event / Server Banner',
    width: 1920,
    height: 1080,
    aspectRatio: '16:9',
    requiredFormat: 'png',
    notes: 'Community announcements.'
  }
};
```

---

## 6. AI Agent Tooling Specification (MCP Interface)

This section details the JSON schema interfaces that AI agents will consume via the built-in MCP server:

### Tool 1: `artisan_list_compositions`
- **Purpose:** Enumerates all templates defined in the current project.
- **Parameters:** None.
- **Returns:**
  ```json
  [
    {
      "id": "steam-main-capsule",
      "name": "Steam Main Capsule",
      "width": 616,
      "height": 353,
      "propsSchema": {
        "type": "object",
        "properties": {
          "title": { "type": "string" },
          "tagline": { "type": "string" },
          "characterCutoutUrl": { "type": "string" },
          "backgroundUrl": { "type": "string" },
          "saleTag": { "type": "string" },
          "accentColor": { "type": "string" }
        },
        "required": ["title", "backgroundUrl"]
      }
    }
  ]
  ```

### Tool 2: `artisan_render`
- **Purpose:** Executes headless rendering of a chosen composition.
- **Parameters:**
  ```json
  {
    "compositionId": "steam-main-capsule",
    "props": {
      "title": "NEON HORIZON",
      "tagline": "A Cyberpunk Rogue-lite",
      "backgroundUrl": "assets/screenshots/combat_01.png",
      "characterCutoutUrl": "assets/sprites/hero_katana.png",
      "saleTag": "-33% THIS WEEK",
      "accentColor": "#00FFAA"
    },
    "format": "png",
    "scale": 2,
    "outputPath": "dist/marketing/steam_main_33off.png"
  }
  ```
- **Returns:**
  ```json
  {
    "status": "success",
    "outputPath": "/absolute/path/to/dist/marketing/steam_main_33off.png",
    "dimensions": { "width": 1232, "height": 706 },
    "fileSizeBytes": 684210,
    "renderDurationMs": 142
  }
  ```

### Tool 3: `artisan_batch_localize`
- **Purpose:** Renders localized assets across multiple languages automatically.
- **Parameters:**
  ```json
  {
    "compositionId": "steam-header-capsule",
    "locales": ["en", "zh-CN", "ja", "ko", "de", "es"],
    "localizationData": {
      "en": { "titleLogo": "assets/logos/logo_en.png", "callout": "PLAY NOW" },
      "zh-CN": { "titleLogo": "assets/logos/logo_zh.png", "callout": "现已发售" },
      "ja": { "titleLogo": "assets/logos/logo_ja.png", "callout": "今すぐプレイ" }
    },
    "outputDir": "dist/localized-headers/"
  }
  ```

---

## 7. Sample Code-as-Canvas Template (Remotion-Inspired TSX)

Here is a concrete example demonstrating how developers and AI agents write image templates in GameArtisan:

```tsx
// templates/SteamMainCapsule.tsx
import React from 'react';
import { z } from 'zod';
import { Composition, Layer, VectorImage, Text, Shadow, Filters } from '@game-artisan/core';

export const SteamMainCapsuleSchema = z.object({
  gameTitle: z.string().default('CHRONO BLADE'),
  genreCallout: z.string().default('ACTION RPG'),
  heroImageUrl: z.string(),
  backgroundImageUrl: z.string(),
  showLaurel: z.boolean().default(true),
  awardText: z.string().default('WINNER - BEST INDIE 2026'),
  accentColor: z.string().default('#FF4400'),
  glowIntensity: z.number().min(0).max(100).default(40)
});

export type SteamMainCapsuleProps = z.infer<typeof SteamMainCapsuleSchema>;

export const SteamMainCapsule: React.FC<SteamMainCapsuleProps> = ({
  gameTitle,
  genreCallout,
  heroImageUrl,
  backgroundImageUrl,
  showLaurel,
  awardText,
  accentColor,
  glowIntensity
}) => {
  return (
    <div
      style={{
        width: 616,
        height: 353,
        position: 'relative',
        overflow: 'hidden',
        backgroundColor: '#0a0a0c',
        fontFamily: "'Cinzel', 'Noto Sans SC', sans-serif"
      }}
    >
      {/* Background Screenshot with cinematic grading */}
      <Layer.Image
        src={backgroundImageUrl}
        width={616}
        height={353}
        style={{
          objectFit: 'cover',
          filter: 'contrast(1.15) brightness(0.85) saturate(1.2)'
        }}
      />

      {/* Atmospheric Vignette & Color Splash */}
      <Layer.Gradient
        type="radial"
        cx="70%"
        cy="50%"
        radius="60%"
        colors={[`${accentColor}44`, 'transparent']}
        blendMode="screen"
      />
      <Layer.Gradient
        type="linear"
        angle={180}
        colors={['transparent', 'rgba(5, 5, 8, 0.95)']}
        stops={[0.5, 1.0]}
      />

      {/* Hero Character Cutout with Silhouette Glow */}
      <Layer.Image
        src={heroImageUrl}
        style={{
          position: 'absolute',
          right: 20,
          bottom: -10,
          height: 340,
          filter: `drop-shadow(0 0 ${glowIntensity}px ${accentColor})`
        }}
      />

      {/* Award Laurel (if enabled) */}
      {showLaurel && (
        <Layer.Group style={{ position: 'absolute', top: 16, right: 16 }}>
          <VectorImage src="vectors/laurel-wreath.svg" width={90} height={45} fill="#FFD700" />
          <Text
            content={awardText}
            style={{
              position: 'absolute',
              top: 14,
              left: 0,
              width: 90,
              textAlign: 'center',
              fontSize: 7,
              fontWeight: 800,
              color: '#FFD700',
              letterSpacing: 0.5
            }}
          />
        </Layer.Group>
      )}

      {/* Title & Branding Lockup */}
      <div style={{ position: 'absolute', left: 24, bottom: 24, maxWidth: 380 }}>
        <Text
          content={genreCallout}
          style={{
            fontSize: 10,
            fontWeight: 800,
            color: accentColor,
            letterSpacing: 2,
            textTransform: 'uppercase',
            marginBottom: 4
          }}
        />
        <Text
          content={gameTitle}
          style={{
            fontSize: 34,
            fontWeight: 900,
            color: '#FFFFFF',
            lineHeight: 1.05,
            textShadow: '0 4px 12px rgba(0,0,0,0.8), 0 0 2px #000'
          }}
        />
      </div>
    </div>
  );
};

// Register composition for CLI, Agent MCP, and Visual Studio
export const registerCompositions = () => {
  return (
    <Composition
      id="steam-main-capsule"
      name="Steam Main Feature Capsule"
      width={616}
      height={353}
      component={SteamMainCapsule}
      schema={SteamMainCapsuleSchema}
      defaultProps={{
        gameTitle: 'CHRONO BLADE',
        genreCallout: 'ACTION ROGUE-LITE',
        heroImageUrl: 'assets/characters/warrior_cutout.png',
        backgroundImageUrl: 'assets/backgrounds/dungeon_boss_arena.png',
        showLaurel: true,
        awardText: 'PAX EAST 2026 BEST COMBAT',
        accentColor: '#FF3366',
        glowIntensity: 35
      }}
    />
  );
};
```

---

## 8. Step-by-Step Implementation Sprints (For Engineering / AI Agents)

```
Sprints Overview:
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│    Sprint 1     │     │    Sprint 2     │     │    Sprint 3     │     │    Sprint 4     │
│  Core UDM AST   │────▶│ Headless CLI &  │────▶│ Visual Studio   │────▶│ Agent Protocol  │
│  & Composition  │     │ Resvg Exporter  │     │ Canva Viewport  │     │ & Templates Pack│
└─────────────────┘     └─────────────────┘     └─────────────────┘     └─────────────────┘
```

### Sprint 1: Engine Foundation & Composition Runtime
1. Initialize pnpm monorepo with Turborepo and TypeScript.
2. Implement `@game-artisan/core`:
   - Zod schemas for artboards, layers, vectors, typography, transforms.
   - Composition registration engine (`<Composition />`, `registerRoot`).
   - Matrix math utility for 2D affine transforms ($T \cdot R \cdot S$).
3. Unit tests verifying prop schema validation and AST serialization.

### Sprint 2: Headless CLI & Rendering Pipeline
1. Implement `@game-artisan/renderer-svg`:
   - React-to-SVG converter.
   - Rust-based `@resvg/resvg-js` wrapper with custom local font loading.
2. Implement `@game-artisan/cli`:
   - Commands: `artisan list`, `artisan inspect <id>`, `artisan render <id>`.
   - Sharp pipeline for WebP, JPEG, and PNG rasterization.
3. End-to-end test rendering a sample $616 \times 353$ Steam capsule in under $200\text{ ms}$.

### Sprint 3: Interactive Visual Studio (Canva-like Experience)
1. Implement `@game-artisan/studio`:
   - Vite-based React application with WebGL/Canvas2D viewport.
   - Smooth pan/zoom, grid guides, and Steam safe-zone overlay toggles.
   - Interactive bounding box gizmos (scale, drag, rotate).
   - Dynamic Props Inspector auto-generated from Zod schema.
2. Two-way binding: dragging a canvas element updates prop variables.

### Sprint 4: Game Templates, MCP Agent Server & Localization Matrix
1. Implement `@game-artisan/templates-game`:
   - Steam full kit (Header, Small, Main, Vertical, Library Hero, Logo, Background).
   - Itch.io and Social cards.
   - Accolade laurels, price tags, and discount badges.
2. Implement `@game-artisan/agent-sdk`:
   - Model Context Protocol (MCP) server over stdio.
   - AI agent tools: `list_templates`, `update_template_props`, `render_asset`.
3. Multi-language batch render workflow validation.

---

## 9. Definition of Done (DoD)

A user story or feature is complete when:
1. **Zero-Flicker Parity:** Images rendered via CLI pixel-match the visual output of the Visual Studio canvas within a $99.8\%$ perceptual hash margin.
2. **Strict Schema Validation:** All props conform to Zod runtime validation with helpful error messages for AI agents.
3. **High-Performance Headless Execution:** Standard Steam capsules render in $< 250\text{ ms}$ on modern hardware.
4. **Vector Fidelity:** Vector shapes and typography remain crisp when rendered at $1\times, 2\times, 4\times$ scaling.
5. **Agent Compatibility:** Tested against an automated AI agent via MCP server with verifiable asset creation without human intervention.