/**
 * @game-artisan/renderer-chromium — headless Chromium (playwright-core) renderer with a
 * pre-warmed page pool. Renders `kind: 'html'` compositions (full DOM/CSS/canvas/WebGL fidelity)
 * and UDM vector compositions (via the isomorphic SVG emitter) at any device pixel ratio, with
 * request-interception asset caching shared across batch runs.
 */
export {
  ChromiumRenderer,
  ARTISAN_ORIGIN,
  sizeSvgRoot,
  type ChromiumLaunchOptions,
  type ChromiumOutputFormat,
  type CaptureOptions,
  type RenderHtmlOptions,
  type ChromiumRenderCompositionOptions,
  type ChromiumRenderOutput,
  type ChromiumRenderCompositionOutput,
  type ChromiumRendererStats,
} from './renderer.js';
export { isChromiumAvailable, launchChromium, chromiumCandidates, globChromiumExecutables, DEFAULT_CHROMIUM_ARGS, type BrowserLaunchOptions } from './discovery.js';
export { AssetCache, defaultAssetCacheDir, type AssetCacheOptions, type AssetCacheStats, type CachedResponse } from './cache.js';
export { Pool, type PoolStats } from './pool.js';
