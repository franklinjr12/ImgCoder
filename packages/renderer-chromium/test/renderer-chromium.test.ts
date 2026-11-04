import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assetFromBytes, CachingAssetResolver, compileComposition, defineComposition, type Artboard, type FontRegistry } from '@game-artisan/core';
import { compareImages, createNodeFontRegistry, rasterizeSvg, renderArtboard } from '@game-artisan/renderer-svg/node';
import { AssetCache, ChromiumRenderer, isChromiumAvailable, Pool, sizeSvgRoot } from '@game-artisan/renderer-chromium';
import { capsuleComposition, heroArtDataUri, htmlComposition } from './fixtures.js';
import { decodePng, pixel, pngSize } from './png.js';

const available = await isChromiumAvailable();
const OUT = process.env.ARTISAN_TEST_OUT; // set to a directory to dump rendered images

describe('Pool', () => {
  it('queues acquisitions beyond its size and hands items over FIFO', async () => {
    let created = 0;
    const pool = new Pool(2, async () => ({ n: ++created }));
    const a = await pool.acquire();
    const b = await pool.acquire();
    let got: { n: number } | null = null;
    const pending = pool.acquire().then((x) => (got = x));
    await new Promise((r) => setTimeout(r, 10));
    expect(got).toBeNull();
    expect(pool.stats.waiting).toBe(1);
    pool.release(a);
    await pending;
    expect(got).toBe(a);
    expect(created).toBe(2);
    pool.release(b);
    pool.release(got!);
    expect(pool.stats.idle).toBe(2);
    await pool.close();
  });
});

describe('sizeSvgRoot', () => {
  it('rewrites root size and keeps geometry via viewBox', () => {
    const out = sizeSvgRoot('<svg xmlns="http://www.w3.org/2000/svg" width="920" height="430"><rect/></svg>', 460, 215);
    expect(out).toMatch(/viewBox="0 0 920 430"/);
    expect(out).toMatch(/width="460"/);
    expect(out).toMatch(/height="215"/);
  });
});

describe.skipIf(!available)('ChromiumRenderer', () => {
  let renderer: ChromiumRenderer;
  let fonts: FontRegistry;
  let hero: string;
  let artboard: Artboard;
  const assets = new CachingAssetResolver(); // data URIs

  beforeAll(async () => {
    [renderer, fonts, hero] = await Promise.all([ChromiumRenderer.launch({ poolSize: 2, cache: { cacheDir: false } }), createNodeFontRegistry({ systemFallback: false }), heroArtDataUri()]);
    artboard = (await compileComposition(capsuleComposition(hero), { fonts, assets, props: {} })).artboard;
    if (OUT) mkdirSync(OUT, { recursive: true });
  });
  afterAll(async () => {
    await renderer?.close();
  });

  it('pre-warms the page pool', () => {
    expect(renderer.stats.pool.created).toBe(2);
    expect(renderer.stats.browserVersion).toMatch(/\d+\./);
  });

  it('PARITY (DoD #1): resvg and Chromium render the same capsule', async () => {
    const [a, b] = await Promise.all([renderArtboard(artboard, { fonts, assets, format: 'png' }), renderer.renderArtboard(artboard, { fonts, assets, format: 'png' })]);
    expect(a.warnings).toEqual([]);
    expect(b.warnings).toEqual([]);
    expect(b.width).toBe(a.width);
    expect(b.height).toBe(a.height);
    const cmp = await compareImages(a.buffer, b.buffer);
    if (OUT) {
      writeFileSync(path.join(OUT, 'parity-resvg.png'), a.buffer);
      writeFileSync(path.join(OUT, 'parity-chromium.png'), b.buffer);
      writeFileSync(path.join(OUT, 'parity.svg'), a.svg ?? '');
    }
    console.log('[parity] capsule 460x215', JSON.stringify(cmp));
    expect(cmp.phashSimilarity).toBeGreaterThanOrEqual(0.95);
    expect(cmp.pixelSimilarity).toBeGreaterThanOrEqual(0.98);
  });

  it('PARITY per feature: every layer type/effect matches on its own', async () => {
    const results: Record<string, unknown> = {};
    for (const layer of artboard.children) {
      // composite over the opaque background layer (what is visible; avoids RGB noise at alpha≈0)
      const solo: Artboard = { ...artboard, children: artboard.children.filter((l) => l === layer || l.id === 'bg' || (layer.clippingMask && l.id === 'panel')) };
      const [a, b] = await Promise.all([renderArtboard(solo, { fonts, assets }), renderer.renderArtboard(solo, { fonts, assets })]);
      const cmp = await compareImages(a.buffer, b.buffer);
      results[layer.id] = { pixel: +cmp.pixelSimilarity.toFixed(4), phash: +cmp.phashSimilarity.toFixed(3), mismatch: +cmp.mismatchRatio.toFixed(4) };
      expect(cmp.pixelSimilarity, layer.id).toBeGreaterThanOrEqual(0.99);
    }
    console.log('[parity] per layer', JSON.stringify(results));
  });

  it('renders at --scale=2 and --scale=4 (device pixel ratio)', async () => {
    const def = capsuleComposition(hero);
    for (const scale of [2, 4]) {
      const out = await renderer.renderComposition(def, { fonts, scale });
      expect(out.width).toBe(460 * scale);
      expect(out.height).toBe(215 * scale);
      expect(pngSize(out.buffer)).toEqual({ width: 460 * scale, height: 215 * scale });
    }
    // fractional DPR
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"><rect width="100" height="50" fill="#f00"/></svg>';
    const buf = await renderer.renderSvg(svg, { width: 100, height: 50, scale: 1.5 });
    expect(pngSize(buf)).toEqual({ width: 150, height: 75 });
    const img = decodePng(buf);
    expect(pixel(img, 75, 37)).toEqual([255, 0, 0, 255]);
  });

  it('scale-2 Chromium output matches resvg at scale 2', async () => {
    const [a, b] = await Promise.all([renderArtboard(artboard, { fonts, assets, scale: 2 }), renderer.renderArtboard(artboard, { fonts, assets, scale: 2 })]);
    const cmp = await compareImages(a.buffer, b.buffer);
    console.log('[parity] capsule @2x', JSON.stringify(cmp));
    expect(cmp.pixelSimilarity).toBeGreaterThanOrEqual(0.98);
  });

  it('encodes JPEG and WebP and keeps transparency', async () => {
    const def = capsuleComposition(hero);
    const jpeg = await renderer.renderComposition(def, { fonts, format: 'jpeg' });
    expect(jpeg.buffer.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
    expect(jpeg.mime).toBe('image/jpeg');
    const webp = await renderer.renderComposition(def, { fonts, format: 'webp' });
    expect(webp.buffer.toString('ascii', 8, 12)).toBe('WEBP');
    const clear = await renderer.renderSvg('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><circle cx="20" cy="20" r="10" fill="#00f"/></svg>', { width: 40, height: 40, transparent: true });
    const img = decodePng(clear);
    expect(pixel(img, 1, 1)[3]).toBe(0);
    expect(pixel(img, 20, 20)).toEqual([0, 0, 255, 255]);
  });

  it('html composition: blend modes, backdrop-filter, script-drawn canvas, fonts and relative assets', async () => {
    const dot = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><circle cx="12" cy="12" r="12" fill="#00ff00"/></svg>');
    const requested: string[] = [];
    const assets = new CachingAssetResolver(async (src) => {
      requested.push(src);
      if (src === 'assets/dot.svg') return assetFromBytes(dot, 'image/svg+xml');
      throw new Error('not found');
    });
    const before = renderer.cache.stats.resolverHits;
    const out = await renderer.renderComposition(htmlComposition, { fonts, assets, props: { title: 'HYPER' }, scale: 2 });
    if (OUT) writeFileSync(path.join(OUT, 'html-fx.png'), out.buffer);
    expect(out.width).toBe(640);
    expect(out.height).toBe(360);
    expect(out.warnings).toEqual([]);
    expect(out.html).toContain('@font-face');
    expect(out.html).toContain('HYPER');
    expect(requested).toContain('assets/dot.svg');
    expect(renderer.cache.stats.resolverHits).toBeGreaterThan(before);
    const img = decodePng(out.buffer);
    // canvas dot (drawn by `script`) at i=0: (10,150) in CSS px
    const [r, g, b] = pixel(img, 20, 300);
    expect(r + g + b).toBeGreaterThan(200);
    // relative asset rendered (green dot top-right at 300,20 css)
    const dotPx = pixel(img, (320 - 8 - 12) * 2, 20 * 2);
    expect(dotPx[1]).toBeGreaterThan(200);
    expect(dotPx[0]).toBeLessThan(80);
    // many distinct colours → rich content
    const colours = new Set<number>();
    for (let i = 0; i < img.data.length; i += 4 * 37) colours.add((img.data[i] << 16) | (img.data[i + 1] << 8) | img.data[i + 2]);
    expect(colours.size).toBeGreaterThan(200);
  });

  it('html composition validates props with the composition schema', async () => {
    await expect(renderer.renderComposition(htmlComposition, { props: { title: 42 } })).rejects.toThrow(/title/);
  });

  it('reports script failures', async () => {
    const bad = defineComposition({ id: 'bad-script', kind: 'html', width: 10, height: 10, component: () => null, script: 'throw new Error("boom")' });
    await expect(renderer.renderComposition(bad)).rejects.toThrow(/boom/);
  });

  it('PDF output (vector compositions and html compositions)', async () => {
    const vec = await renderer.renderComposition(capsuleComposition(hero), { fonts, format: 'pdf' });
    expect(vec.buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(vec.mime).toBe('application/pdf');
    const html = await renderer.renderComposition(htmlComposition, { fonts, format: 'pdf' });
    expect(html.buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect((html.buffer.toString('latin1').match(/\/Type\s*\/Page\b/g) ?? []).length).toBe(1);
  });

  it('renders concurrently through the pool (more jobs than pages)', async () => {
    const outs = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        renderer.renderSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="rgb(${i * 40},0,0)"/></svg>`, { width: 20, height: 20, scale: i % 2 ? 2 : 1 }),
      ),
    );
    outs.forEach((buf, i) => {
      const img = decodePng(buf);
      expect(img.width).toBe(i % 2 ? 40 : 20);
      expect(pixel(img, 5, 5)[0]).toBe(i * 40);
    });
    expect(renderer.stats.pool.created).toBeLessThanOrEqual(2);
  });
});

describe.skipIf(!available)('remote asset caching (US-2.3)', () => {
  let server: http.Server;
  let base: string;
  let hits = 0;
  let png: Buffer;
  let dir: string;

  beforeAll(async () => {
    png = (await rasterizeSvg('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="#ff8800"/></svg>')).png;
    server = http.createServer((req, res) => {
      if (req.url?.startsWith('/hero.png')) {
        hits++;
        res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' });
        res.end(png);
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    dir = mkdtempSync(path.join(os.tmpdir(), 'artisan-chromium-cache-'));
  });
  afterAll(async () => {
    await new Promise((r) => server.close(r));
    rmSync(dir, { recursive: true, force: true });
  });

  const remoteComposition = () =>
    defineComposition({
      id: 'remote-asset',
      kind: 'html',
      width: 64,
      height: 64,
      component: () => null,
      head: `<style>body{background:#000}</style>`,
      script: `const img = new Image(); img.src = window.__ARTISAN_BASE__ + '/hero.png'; img.style.cssText = 'position:absolute;left:0;top:0;width:64px;height:64px'; root.appendChild(img); await img.decode();`,
    });

  it('fetches each remote graphic once across renders (memory) and across renderer instances (disk)', async () => {
    const def = { ...remoteComposition(), head: `<script>window.__ARTISAN_BASE__=${JSON.stringify(base)}</script>` };
    const r1 = await ChromiumRenderer.launch({ poolSize: 1, cache: { cacheDir: dir } });
    try {
      const a = await r1.renderComposition(def);
      const b = await r1.renderComposition(def, { scale: 2 });
      expect(hits).toBe(1);
      expect(r1.cache.stats.networkFetches).toBe(1);
      expect(r1.cache.stats.memoryHits).toBeGreaterThanOrEqual(1);
      expect(pixel(decodePng(a.buffer), 32, 32)).toEqual([255, 136, 0, 255]);
      expect(pixel(decodePng(b.buffer), 64, 64)).toEqual([255, 136, 0, 255]);
    } finally {
      await r1.close();
    }
    // a new batch run (fresh process memory) reuses the disk cache
    const r2 = await ChromiumRenderer.launch({ poolSize: 1, cache: new AssetCache({ cacheDir: dir }) });
    try {
      const c = await r2.renderComposition(def);
      expect(hits).toBe(1);
      expect(r2.cache.stats.diskHits).toBe(1);
      expect(pixel(decodePng(c.buffer), 32, 32)).toEqual([255, 136, 0, 255]);
    } finally {
      await r2.close();
    }
  });

  it('caches <img> markup references in html compositions too', async () => {
    const start = hits;
    const def = defineComposition({ id: 'remote-img', kind: 'html', width: 32, height: 32, component: () => null });
    const r = await ChromiumRenderer.launch({ poolSize: 2, cache: { cacheDir: false } });
    try {
      const html = `<img src="${base}/hero.png?v=2" width="32" height="32">`;
      await Promise.all([r.renderHtml(html, { width: 32, height: 32 }), r.renderHtml(html, { width: 32, height: 32 }), r.renderHtml(html, { width: 32, height: 32 })]);
      expect(hits - start).toBe(1);
      expect(def.kind).toBe('html');
    } finally {
      await r.close();
    }
  });
});
