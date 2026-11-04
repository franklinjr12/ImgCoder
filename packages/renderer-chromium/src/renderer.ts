/**
 * ChromiumRenderer — the "full DOM / WebGL" half of GameArtisan's dual renderer strategy.
 *
 *  - vector compositions: core emitter → SVG (text outlined) → loaded as a standalone SVG document
 *    in Chromium → screenshot at an arbitrary device pixel ratio (parity with resvg, DoD #1).
 *  - html compositions: React → static markup + registered @font-face + `head` + `script`
 *    (canvas / WebGL / CSS blend modes / backdrop-filter) → screenshot or vector PDF.
 *
 * Pages are served from a fake origin (`http://artisan.local/`) through request interception, so
 * project-relative URLs (`assets/hero.png`) resolve through an AssetResolver and remote http(s)
 * assets are answered from an LRU + disk cache shared across batch runs (US-2.3).
 */
import { createHash } from 'node:crypto';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Browser, BrowserContext, Page, Route } from 'playwright-core';
import {
  compileComposition,
  renderArtboardToSvg,
  resolveProps,
  splitMetaProps,
  withRenderContext,
  parseDataUri,
  CachingAssetResolver,
  mimeFromPath,
  probeSvgSize,
  type Artboard,
  type AssetResolver,
  type CompositionDefinition,
  type FontRegistry,
  type LayerOverrides,
} from '@game-artisan/core';
import { encodeRaster, FORMAT_MIME, type EncodeOptions } from '@game-artisan/renderer-svg/node';
import { launchChromium, type BrowserLaunchOptions } from './discovery.js';
import { AssetCache, type AssetCacheOptions, type AssetCacheStats } from './cache.js';
import { Pool, type PoolStats } from './pool.js';

/** Fake origin every page is served from. */
export const ARTISAN_ORIGIN = 'http://artisan.local';
const INTERNAL = '/__artisan__/';

export type ChromiumOutputFormat = 'png' | 'jpeg' | 'webp' | 'pdf';

export interface ChromiumLaunchOptions extends BrowserLaunchOptions {
  /** Pre-warmed pages (one browser context each). Default 2. */
  poolSize?: number;
  /** Device scale factors to pre-warm pages with. Default [1]. */
  prewarmScales?: number[];
  /** Default resolver for project-relative URLs requested by pages (per-render `assets` wins). */
  assets?: AssetResolver;
  /** Remote asset cache (an AssetCache instance can be shared between renderers). */
  cache?: AssetCacheOptions | AssetCache;
  /** Allow pages to load http(s) resources. Default true. */
  allowRemote?: boolean;
  /** Per-render timeout (navigation, readiness, capture) in ms. Default 30000. */
  timeoutMs?: number;
  /** How registered fonts reach html pages: served from the fake origin (default) or inlined as base64. */
  fontEmbedding?: 'url' | 'base64';
}

export interface CaptureOptions {
  /** CSS pixel size of the artboard (defaults to the SVG's own size for renderSvg). */
  width: number;
  height: number;
  /** Device pixel ratio (1, 2, 4, or any positive number). Default 1. */
  scale?: number;
  format?: ChromiumOutputFormat;
  /** Keep transparency (PNG/WebP). */
  transparent?: boolean;
  /** Raster encoder options (JPEG/WebP quality, size limits…) — same as renderer-svg. */
  encode?: EncodeOptions;
  /** Resolver for project-relative URLs requested during this render. */
  assets?: AssetResolver;
  timeoutMs?: number;
}

export interface RenderHtmlOptions extends CaptureOptions {
  /** Fonts injected as @font-face (every registered face). */
  fonts?: FontRegistry;
  /** Extra HTML for <head>. */
  head?: string;
  /** JS (async function body) run before capture; receives `props`, `root`, `width`, `height`. */
  script?: string;
  props?: Record<string, unknown>;
  locale?: string;
}

export interface ChromiumRenderCompositionOptions {
  /** Font registry (default: bundled fonts via renderer-svg `createNodeFontRegistry`). */
  fonts?: FontRegistry;
  assets?: AssetResolver;
  props?: Record<string, unknown>;
  overrides?: LayerOverrides;
  locale?: string;
  scale?: number;
  format?: ChromiumOutputFormat;
  transparent?: boolean;
  encode?: EncodeOptions;
  onMissingAsset?: 'error' | 'placeholder';
  timeoutMs?: number;
}

export interface ChromiumRenderOutput {
  buffer: Buffer;
  format: ChromiumOutputFormat;
  mime: string;
  /** Output pixel size (CSS size × scale; CSS size for PDF). */
  width: number;
  height: number;
  /** Emitted SVG (vector compositions). */
  svg?: string;
  /** Page HTML (html compositions). */
  html?: string;
  warnings: string[];
  timings: { emitMs: number; rasterMs: number; encodeMs: number; totalMs: number; compileMs?: number };
}

export interface ChromiumRenderCompositionOutput extends ChromiumRenderOutput {
  props: Record<string, unknown>;
  artboard?: Artboard;
}

export interface ChromiumRendererStats {
  executablePath: string;
  browserVersion: string;
  renders: number;
  pool: PoolStats;
  cache: AssetCacheStats;
}

interface Slot {
  id: number;
  context: BrowserContext;
  page: Page;
  dpr: number;
  assets?: AssetResolver;
}

interface ServedFile {
  body: Buffer;
  contentType: string;
}

const FONT_FORMAT: Record<string, { mime: string; css: string }> = {
  ttf: { mime: 'font/ttf', css: 'truetype' },
  otf: { mime: 'font/otf', css: 'opentype' },
  woff: { mime: 'font/woff', css: 'woff' },
  woff2: { mime: 'font/woff2', css: 'woff2' },
};

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const cssStr = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
const fmtPx = (n: number) => String(Math.round(n * 1000) / 1000);

/** Force the root <svg> to a CSS size (keeps geometry via viewBox). */
export function sizeSvgRoot(svg: string, width: number, height: number): string {
  const m = /<svg\b[^>]*>/i.exec(svg);
  if (!m) throw new Error('renderSvg: input has no <svg> root element');
  let tag = m[0];
  const attr = (n: string) => new RegExp(`\\s${n}\\s*=\\s*(["'])([^"']*)\\1`, 'i').exec(tag)?.[2];
  const ow = parseFloat(attr('width') ?? '');
  const oh = parseFloat(attr('height') ?? '');
  if (!attr('viewBox') && ow > 0 && oh > 0 && !/%/.test(attr('width')!)) tag = tag.replace(/^<svg\b/i, `<svg viewBox="0 0 ${ow} ${oh}"`);
  for (const [n, v] of [['width', width], ['height', height]] as const) {
    const re = new RegExp(`(\\s)${n}\\s*=\\s*(["'])[^"']*\\2`, 'i');
    tag = re.test(tag) ? tag.replace(re, `$1${n}="${fmtPx(v)}"`) : tag.replace(/^<svg\b/i, `<svg ${n}="${fmtPx(v)}"`);
  }
  if (!/\sxmlns\s*=/.test(tag)) tag = tag.replace(/^<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  return svg.slice(0, m.index) + tag + svg.slice(m.index + m[0].length);
}

function isBrokenPageError(err: unknown, slot: Slot): boolean {
  if (slot.page.isClosed()) return true;
  const msg = String((err as Error)?.message ?? err);
  return /Target (page, context or browser )?(has been )?closed|crash|Browser has been closed|Navigation failed because page/i.test(msg);
}

export class ChromiumRenderer {
  private pool!: Pool<Slot>;
  private browser!: Browser;
  private relaunching: Promise<Browser> | null = null;
  private docs = new Map<string, ServedFile>();
  private fontFiles = new Map<string, ServedFile>();
  private fontCss = new WeakMap<FontRegistry, { revision: number; mode: string; css: string }>();
  private slotIds = 0;
  private docIds = 0;
  private renders = 0;
  private defaultFontsP: Promise<FontRegistry> | null = null;
  /** Fallback resolver (data URIs only) so the emitter never substitutes placeholders for inline images. */
  private readonly dataResolver = new CachingAssetResolver();
  readonly cache: AssetCache;
  executablePath = '';

  private constructor(readonly options: ChromiumLaunchOptions) {
    this.cache = options.cache instanceof AssetCache ? options.cache : new AssetCache(options.cache);
  }

  /** Launch Chromium and pre-warm a pool of pages. */
  static async launch(opts: ChromiumLaunchOptions = {}): Promise<ChromiumRenderer> {
    const r = new ChromiumRenderer(opts);
    const { browser, executablePath } = await launchChromium(opts);
    r.browser = browser;
    r.executablePath = executablePath;
    const size = Math.max(1, Math.floor(opts.poolSize ?? 2));
    const scales = opts.prewarmScales?.length ? opts.prewarmScales : [1];
    let n = 0;
    r.pool = new Pool<Slot>(size, () => r.createSlot(scales[n++ % scales.length]), (s) => s.context.close().catch(() => {}));
    await r.pool.warm(size);
    return r;
  }

  get stats(): ChromiumRendererStats {
    return {
      executablePath: this.executablePath,
      browserVersion: this.browser?.isConnected() ? this.browser.version() : 'disconnected',
      renders: this.renders,
      pool: this.pool.stats,
      cache: this.cache.stats,
    };
  }

  /** Shut down the pool and the browser. */
  async close(): Promise<void> {
    await this.pool?.close();
    await this.browser?.close().catch(() => {});
    this.docs.clear();
  }

  // -------------------------------------------------------------------------------------
  // Browser / page pool

  private async ensureBrowser(): Promise<Browser> {
    if (this.browser.isConnected()) return this.browser;
    this.relaunching ??= launchChromium(this.options)
      .then(({ browser }) => (this.browser = browser))
      .finally(() => (this.relaunching = null));
    return this.relaunching;
  }

  private async createSlot(dpr = 1): Promise<Slot> {
    const slot = { id: ++this.slotIds, dpr } as Slot;
    await this.openContext(slot, dpr);
    return slot;
  }

  /** (Re)open a slot's browser context + page with the given device scale factor. */
  private async openContext(slot: Slot, dpr: number): Promise<void> {
    const browser = await this.ensureBrowser();
    const context = await browser.newContext({
      viewport: { width: 800, height: 600 },
      deviceScaleFactor: dpr,
      colorScheme: 'light',
      reducedMotion: 'reduce',
      serviceWorkers: 'block',
      ignoreHTTPSErrors: true,
    });
    try {
      await context.route('**/*', (route) => this.handleRoute(route, slot));
      const page = await context.newPage();
      page.setDefaultTimeout(this.options.timeoutMs ?? 30_000);
      // Warm the renderer process + raster path.
      const warm = this.publish(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'), 'image/svg+xml', 'svg');
      await page.goto(warm).catch(() => {});
      this.unpublish(warm);
      slot.context = context;
      slot.page = page;
      slot.dpr = dpr;
    } catch (e) {
      await context.close().catch(() => {});
      throw e;
    }
  }

  /** Re-create a slot's context with a different device scale factor (DPR is per context). */
  private async reconfigure(slot: Slot, dpr: number): Promise<void> {
    await slot.context?.close().catch(() => {});
    await this.openContext(slot, dpr);
  }

  private async withPage<R>(scale: number, assets: AssetResolver | undefined, fn: (slot: Slot) => Promise<R>): Promise<R> {
    return this.pool.use(
      async (slot) => {
        if (slot.dpr !== scale || slot.page.isClosed()) await this.reconfigure(slot, scale);
        slot.assets = assets;
        try {
          return await fn(slot);
        } finally {
          slot.assets = undefined;
        }
      },
      { prefer: (s) => s.dpr === scale, isBroken: isBrokenPageError },
    );
  }

  // -------------------------------------------------------------------------------------
  // Request interception: fake origin + asset cache

  private publish(body: Buffer, contentType: string, ext: string): string {
    const id = `d${++this.docIds}`;
    this.docs.set(id, { body, contentType });
    // Served at the origin root so relative URLs (`assets/hero.png`) resolve to `/assets/hero.png`.
    return `${ARTISAN_ORIGIN}/__artisan__doc-${id}.${ext}`;
  }

  private unpublish(url: string): void {
    const id = /__artisan__doc-([a-z0-9]+)\./.exec(url)?.[1];
    if (id) this.docs.delete(id);
  }

  private async handleRoute(route: Route, slot: Slot): Promise<void> {
    const request = route.request();
    const url = request.url();
    try {
      if (url.startsWith(`${ARTISAN_ORIGIN}/`)) return await this.serveLocal(route, slot, url);
      if (/^https?:\/\//i.test(url)) {
        if (this.options.allowRemote === false) {
          this.cache.record('errors');
          return await route.abort('blockedbyclient');
        }
        if (request.method() !== 'GET') return await route.continue();
        const r = await this.cache.get(url, async () => {
          const resp = await route.fetch({ timeout: this.options.timeoutMs ?? 30_000 });
          return { body: await resp.body(), contentType: resp.headers()['content-type'] ?? mimeFromPath(url), status: resp.status() };
        });
        if (r.status >= 400) this.cache.record('errors');
        return await route.fulfill({ status: r.status, body: r.body, contentType: r.contentType, headers: { 'access-control-allow-origin': '*', 'cache-control': 'max-age=31536000' } });
      }
      return await route.continue();
    } catch (e) {
      this.cache.record('errors');
      await route.abort('failed').catch(() => {});
    }
  }

  private async serveLocal(route: Route, slot: Slot, url: string): Promise<void> {
    const u = new URL(url);
    const doc = /^\/__artisan__doc-([a-z0-9]+)\./.exec(u.pathname);
    if (doc) {
      const f = this.docs.get(doc[1]);
      return f ? route.fulfill({ status: 200, body: f.body, contentType: f.contentType }) : route.fulfill({ status: 404, body: 'gone' });
    }
    if (u.pathname.startsWith(`${INTERNAL}font/`)) {
      const f = this.fontFiles.get(u.pathname.slice(`${INTERNAL}font/`.length));
      return f ? route.fulfill({ status: 200, body: f.body, contentType: f.contentType, headers: { 'access-control-allow-origin': '*' } }) : route.fulfill({ status: 404, body: 'font not found' });
    }
    if (u.pathname === '/favicon.ico') return route.fulfill({ status: 404, body: '' });
    // Project-relative asset → AssetResolver
    const resolver = slot.assets ?? this.options.assets;
    const rel = decodeURIComponent(u.pathname.replace(/^\/+/, ''));
    if (!resolver || !rel) {
      this.cache.record('errors');
      return route.fulfill({ status: 404, body: `No AssetResolver for ${rel}` });
    }
    try {
      const asset = await resolver.resolve(rel);
      let body: Buffer | undefined;
      let mime = asset.mime;
      if (asset.data) body = Buffer.from(asset.data.buffer, asset.data.byteOffset, asset.data.byteLength);
      else if (asset.text != null) body = Buffer.from(asset.text, 'utf8');
      else {
        const parsed = parseDataUri(asset.href);
        if (parsed) {
          body = Buffer.from(parsed.data);
          mime = mime || parsed.mime;
        }
      }
      if (!body) {
        // resolver returned a plain URL → let Chromium (and the remote cache) load it
        if (/^https?:/i.test(asset.href)) return route.fulfill({ status: 302, headers: { location: asset.href } });
        throw new Error('asset has no data');
      }
      this.cache.record('resolverHits');
      return route.fulfill({ status: 200, body, contentType: mime || mimeFromPath(rel), headers: { 'access-control-allow-origin': '*' } });
    } catch (e) {
      this.cache.record('errors');
      return route.fulfill({ status: 404, body: `Asset not found: ${rel} (${(e as Error).message})` });
    }
  }

  // -------------------------------------------------------------------------------------
  // Fonts

  /** @font-face rules for every registered face with bytes. */
  fontFaceCss(fonts: FontRegistry): string {
    const mode = this.options.fontEmbedding ?? 'url';
    const cached = this.fontCss.get(fonts);
    if (cached && cached.revision === fonts.revision && cached.mode === mode) return cached.css;
    const rules: string[] = [];
    const seen = new Set<string>();
    for (const f of fonts.list()) {
      const key = `${f.family}|${f.weight}|${f.style}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const full = fonts.match(f.family, f.weight, f.style);
      if (!full?.data || full.family !== f.family || full.weight !== f.weight) continue;
      const fmt = FONT_FORMAT[full.format ?? 'ttf'];
      if (!fmt) continue;
      let src: string;
      const bytes = Buffer.from(full.data.buffer, full.data.byteOffset, full.data.byteLength);
      if (mode === 'base64') src = `url(data:${fmt.mime};base64,${bytes.toString('base64')})`;
      else {
        const name = `${createHash('sha1').update(bytes).digest('hex').slice(0, 20)}.${full.format ?? 'ttf'}`;
        if (!this.fontFiles.has(name)) this.fontFiles.set(name, { body: bytes, contentType: fmt.mime });
        src = `url('${ARTISAN_ORIGIN}${INTERNAL}font/${name}')`;
      }
      rules.push(`@font-face{font-family:'${cssStr(f.family)}';font-weight:${f.weight};font-style:${f.style};font-display:block;src:${src} format('${fmt.css}');}`);
    }
    const css = rules.join('\n');
    this.fontCss.set(fonts, { revision: fonts.revision, mode, css });
    return css;
  }

  private defaultFonts(): Promise<FontRegistry> {
    this.defaultFontsP ??= import('@game-artisan/renderer-svg/node').then((m) => m.createNodeFontRegistry({ systemFallback: false }));
    return this.defaultFontsP;
  }

  // -------------------------------------------------------------------------------------
  // Capture

  private async settle(page: Page, timeout: number): Promise<void> {
    await page.evaluate(async (t) => {
      const deadline = Date.now() + t;
      const within = <T,>(p: Promise<T>) => Promise.race([p, new Promise<void>((r) => setTimeout(r, Math.max(0, deadline - Date.now())))]);
      if (document.fonts) await within(document.fonts.ready as Promise<unknown> as Promise<void>);
      const imgs = Array.from(document.images ?? []);
      await within(
        Promise.all(
          imgs.map((img) =>
            img.complete
              ? img.decode?.().catch(() => {})
              : new Promise<void>((r) => {
                  img.addEventListener('load', () => r(), { once: true });
                  img.addEventListener('error', () => r(), { once: true });
                }),
          ),
        ).then(() => {}),
      );
      await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
    }, timeout);
  }

  private async capture(page: Page, o: CaptureOptions, warnings: string[]): Promise<{ buffer: Buffer; rasterMs: number; encodeMs: number }> {
    const format = o.format ?? 'png';
    const t0 = performance.now();
    if (format === 'pdf') {
      await page.emulateMedia({ media: 'screen' });
      const buffer = await page.pdf({
        width: `${fmtPx(o.width)}px`,
        height: `${fmtPx(o.height)}px`,
        printBackground: true,
        pageRanges: '1',
        margin: { top: '0', right: '0', bottom: '0', left: '0' },
      });
      return { buffer, rasterMs: performance.now() - t0, encodeMs: 0 };
    }
    const png = await page.screenshot({
      type: 'png',
      clip: { x: 0, y: 0, width: o.width, height: o.height },
      omitBackground: !!o.transparent,
      animations: 'disabled',
      caret: 'hide',
      scale: 'device',
      timeout: o.timeoutMs ?? this.options.timeoutMs ?? 30_000,
    });
    const t1 = performance.now();
    const needsEncode = format !== 'png' || o.encode?.palette || o.encode?.background || o.encode?.maxFileSizeBytes || o.encode?.withMetadata;
    const buffer = needsEncode ? await encodeRaster(png, format, o.encode) : png;
    if (o.encode?.maxFileSizeBytes && buffer.length > o.encode.maxFileSizeBytes) warnings.push(`Output ${buffer.length} bytes exceeds maxFileSizeBytes ${o.encode.maxFileSizeBytes}`);
    return { buffer, rasterMs: t1 - t0, encodeMs: performance.now() - t1 };
  }

  private checkScale(scale: number): number {
    if (!(scale > 0) || !Number.isFinite(scale) || scale > 16) throw new Error(`Invalid scale ${scale} (expected 0 < scale <= 16)`);
    return scale;
  }

  private output(format: ChromiumOutputFormat, buffer: Buffer, w: number, h: number, scale: number, extra: Partial<ChromiumRenderOutput>, timings: ChromiumRenderOutput['timings']): ChromiumRenderOutput {
    this.renders++;
    const px = format === 'pdf' ? 1 : scale;
    return { buffer, format, mime: FORMAT_MIME[format], width: Math.round(w * px), height: Math.round(h * px), warnings: [], ...extra, timings };
  }

  /** Render an SVG string in Chromium (standalone SVG document, sized to the artboard). */
  async renderSvg(svg: string, opts: Partial<CaptureOptions> = {}): Promise<Buffer> {
    return (await this.renderSvgDetailed(svg, opts)).buffer;
  }

  /** Like renderSvg, returning the full RenderOutput-style result. */
  async renderSvgDetailed(svg: string, opts: Partial<CaptureOptions> = {}): Promise<ChromiumRenderOutput> {
    const t0 = performance.now();
    const size = opts.width && opts.height ? { width: opts.width, height: opts.height } : probeSvgSize(svg);
    if (!size) throw new Error('renderSvg: width/height missing and not derivable from the SVG');
    const scale = this.checkScale(opts.scale ?? 1);
    const format = opts.format ?? 'png';
    const timeout = opts.timeoutMs ?? this.options.timeoutMs ?? 30_000;
    const warnings: string[] = [];
    const body = Buffer.from(sizeSvgRoot(svg, size.width, size.height), 'utf8');
    return this.withPage(scale, opts.assets, async ({ page }) => {
      const url = this.publish(body, 'image/svg+xml', 'svg');
      try {
        await page.setViewportSize({ width: Math.max(1, Math.ceil(size.width)), height: Math.max(1, Math.ceil(size.height)) });
        await page.goto(url, { waitUntil: 'load', timeout });
        await this.settle(page, timeout);
        const tl = performance.now();
        const cap = await this.capture(page, { ...opts, ...size, scale, format, timeoutMs: timeout }, warnings);
        return this.output(format, cap.buffer, size.width, size.height, scale, { svg, warnings }, { emitMs: 0, rasterMs: tl - t0 + cap.rasterMs, encodeMs: cap.encodeMs, totalMs: performance.now() - t0 });
      } finally {
        this.unpublish(url);
      }
    });
  }

  /** Render an HTML fragment (or full document) at width×height. */
  async renderHtml(markup: string, opts: RenderHtmlOptions): Promise<ChromiumRenderOutput> {
    const t0 = performance.now();
    const scale = this.checkScale(opts.scale ?? 1);
    const format = opts.format ?? 'png';
    const timeout = opts.timeoutMs ?? this.options.timeoutMs ?? 30_000;
    const { width, height } = opts;
    if (!(width > 0 && height > 0)) throw new Error('renderHtml: width/height required');
    const html = this.buildHtmlDocument(markup, opts);
    const warnings: string[] = [];
    const emitMs = performance.now() - t0;
    return this.withPage(scale, opts.assets, async ({ page }) => {
      const url = this.publish(Buffer.from(html, 'utf8'), 'text/html; charset=utf-8', 'html');
      const onError = (e: Error) => warnings.push(`Page error: ${e.message}`);
      page.on('pageerror', onError);
      try {
        await page.setViewportSize({ width: Math.max(1, Math.ceil(width)), height: Math.max(1, Math.ceil(height)) });
        await page.goto(url, { waitUntil: 'load', timeout });
        if (opts.script) {
          const err = await page.evaluate(
            async ({ script, props, width, height }) => {
              try {
                const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (...args: string[]) => (...a: unknown[]) => Promise<unknown>;
                const fn = new AsyncFunction('props', 'root', 'width', 'height', script);
                await fn(props, document.getElementById('artisan-root'), width, height);
                return null;
              } catch (e) {
                return String((e as Error)?.stack ?? e);
              }
            },
            { script: opts.script, props: opts.props ?? {}, width, height },
          );
          if (err) throw new Error(`Composition script failed: ${err}`);
        }
        // window.__ARTISAN_READY__: undefined/true = ready, false = wait, Promise = await
        await page.waitForFunction(
          () => {
            const w = window as any;
            const r = w.__ARTISAN_READY__;
            if (r && typeof r.then === 'function') {
              if (!r.__artisanTracked) {
                r.__artisanTracked = true;
                r.then(
                  () => (w.__ARTISAN_READY__ = true),
                  (e: unknown) => ((w.__ARTISAN_READY_ERROR__ = String(e)), (w.__ARTISAN_READY__ = true)),
                );
              }
              return false;
            }
            return r === undefined || r === null || r === true;
          },
          undefined,
          { timeout, polling: 'raf' },
        );
        const readyErr = await page.evaluate(() => (window as any).__ARTISAN_READY_ERROR__ as string | undefined);
        if (readyErr) throw new Error(`Composition readiness failed: ${readyErr}`);
        await this.settle(page, timeout);
        const tl = performance.now();
        const cap = await this.capture(page, { ...opts, scale, format, timeoutMs: timeout }, warnings);
        return this.output(format, cap.buffer, width, height, scale, { html, warnings }, { emitMs, rasterMs: tl - t0 - emitMs + cap.rasterMs, encodeMs: cap.encodeMs, totalMs: performance.now() - t0 });
      } finally {
        page.off('pageerror', onError);
        this.unpublish(url);
      }
    });
  }

  /** Build the page document for an html composition. */
  buildHtmlDocument(markup: string, opts: RenderHtmlOptions): string {
    const fontCss = opts.fonts ? this.fontFaceCss(opts.fonts) : '';
    const propsJson = JSON.stringify(opts.props ?? {}).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
    const base =
      `html,body{margin:0;padding:0;background:${opts.transparent ? 'transparent' : '#ffffff'};}` +
      `#artisan-root{position:relative;width:${fmtPx(opts.width)}px;height:${fmtPx(opts.height)}px;overflow:hidden;}` +
      `@page{size:${fmtPx(opts.width)}px ${fmtPx(opts.height)}px;margin:0;}`;
    if (/^\s*(<!doctype|<html)/i.test(markup)) {
      // Full document supplied: inject our head bits.
      const inject = `<style id="artisan-fonts">${fontCss}</style><script>window.__ARTISAN_PROPS__=${propsJson};</script>${opts.head ?? ''}`;
      return /<head[^>]*>/i.test(markup) ? markup.replace(/<head[^>]*>/i, (h) => h + inject) : markup.replace(/<html[^>]*>/i, (h) => `${h}<head>${inject}</head>`);
    }
    return (
      `<!doctype html><html${opts.locale ? ` lang="${esc(opts.locale)}"` : ''}><head><meta charset="utf-8">` +
      `<meta name="viewport" content="width=${fmtPx(opts.width)}">` +
      `<style id="artisan-fonts">${fontCss}</style><style id="artisan-base">${base}</style>` +
      `<script>window.__ARTISAN_PROPS__=${propsJson};window.__ARTISAN__={width:${opts.width},height:${opts.height},locale:${JSON.stringify(opts.locale ?? null)}};</script>` +
      `${opts.head ?? ''}</head><body><div id="artisan-root">${markup}</div></body></html>`
    );
  }

  // -------------------------------------------------------------------------------------
  // High-level API (mirrors renderer-svg's renderArtboard / renderComposition)

  /** Emit a UDM artboard to SVG (text outlined) and rasterise it in Chromium. */
  async renderArtboard(artboard: Artboard, opts: ChromiumRenderCompositionOptions & { fonts: FontRegistry }): Promise<ChromiumRenderOutput> {
    const t0 = performance.now();
    const transparent = opts.transparent ?? (!artboard.background || artboard.background.type === 'none');
    const { svg, warnings, width, height } = await renderArtboardToSvg(artboard, {
      fonts: opts.fonts,
      assets: opts.assets ?? this.options.assets ?? this.dataResolver,
      scale: 1,
      textMode: 'outline',
      locale: opts.locale ?? artboard.locale,
      background: !transparent,
      annotate: false,
      onMissingAsset: opts.onMissingAsset,
    });
    const emitMs = performance.now() - t0;
    const out = await this.renderSvgDetailed(svg, { width, height, scale: opts.scale, format: opts.format, transparent, encode: opts.encode, assets: opts.assets, timeoutMs: opts.timeoutMs });
    return { ...out, warnings: [...warnings, ...out.warnings], timings: { ...out.timings, emitMs, totalMs: out.timings.totalMs + emitMs } };
  }

  /** Compile + render any composition: vector (default) through SVG, `kind: 'html'` through React DOM. */
  async renderComposition(def: CompositionDefinition, opts: ChromiumRenderCompositionOptions = {}): Promise<ChromiumRenderCompositionOutput> {
    const t0 = performance.now();
    const fonts = opts.fonts ?? (await this.defaultFonts());
    if (def.kind === 'html') {
      if (!def.component) throw new Error(`html composition "${def.id}" needs a component`);
      const { meta } = splitMetaProps(opts.props ?? {});
      const props = resolveProps(def, opts.props ?? {});
      const locale = opts.locale ?? (meta.locale as string | undefined);
      const markup = withRenderContext({ compositionId: def.id, width: def.width, height: def.height, locale, props, surface: 'chromium' }, () =>
        renderToStaticMarkup(createElement(def.component as any, props)),
      );
      const compileMs = performance.now() - t0;
      const out = await this.renderHtml(markup, {
        width: def.width,
        height: def.height,
        scale: opts.scale,
        format: opts.format,
        transparent: opts.transparent ?? false,
        encode: opts.encode,
        assets: opts.assets,
        fonts,
        head: def.head,
        script: def.script,
        props,
        locale,
        timeoutMs: opts.timeoutMs,
      });
      return { ...out, props, timings: { ...out.timings, compileMs, totalMs: out.timings.totalMs + compileMs } };
    }
    const { artboard, props } = await compileComposition(def, { fonts, assets: opts.assets ?? this.options.assets ?? this.dataResolver, props: opts.props, overrides: opts.overrides, locale: opts.locale, surface: 'chromium' });
    const compileMs = performance.now() - t0;
    const out = await this.renderArtboard(artboard, { ...opts, fonts });
    return { ...out, props, artboard, timings: { ...out.timings, compileMs, totalMs: out.timings.totalMs + compileMs } };
  }
}
