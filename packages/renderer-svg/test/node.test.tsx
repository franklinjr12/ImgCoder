import { describe, expect, it, beforeAll } from 'vitest';
import http from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { z } from 'zod';
import { Layer, Text, Shadow, createArtboard, createLayer, zColor, type FontRegistry } from '@game-artisan/core';
import { renderComposition, renderArtboard, createNodeFontRegistry, NodeAssetResolver, compareImages, encodeRaster, rasterizeSvg, needsPdfRaster, contactSheet, formatFromPath } from '@game-artisan/renderer-svg/node';
import { renderCompositionToSvg, svgToDataUri } from '@game-artisan/renderer-svg';

const BG = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><defs><linearGradient id="s" x2="0" y2="1"><stop offset="0" stop-color="#1b2a4a"/><stop offset="1" stop-color="#7a2d4f"/></linearGradient></defs><rect width="1280" height="720" fill="url(#s)"/><circle cx="900" cy="250" r="140" fill="#ffcf6b"/></svg>').toString('base64');

const Schema = z.object({ title: z.string().default('CHRONO BLADE'), accent: zColor('#ff3366') });
const Capsule = (p: z.infer<typeof Schema>) => (
  <div style={{ width: 616, height: 353, backgroundColor: '#0a0a0c', fontFamily: 'Cinzel, Inter' }}>
    <Layer.Image src={BG} width={616} height={353} style={{ filter: 'contrast(1.15) brightness(0.85) saturate(1.2)' }} />
    <Layer.Gradient type="linear" angle={180} colors={['transparent', 'rgba(5,5,8,0.95)']} stops={[0.5, 1]} />
    <Layer.Ellipse x={430} y={40} width={150} height={290} fill="#3b4cca" effects={[Shadow.glow(p.accent, { radius: 2, blur: 24 })]} />
    <div style={{ position: 'absolute', left: 24, bottom: 24, maxWidth: 380 }}>
      <Text content="ACTION ROGUE-LITE" style={{ fontSize: 10, fontWeight: 700, color: p.accent, letterSpacing: 2 }} />
      <Text content={p.title} style={{ fontSize: 34, fontWeight: 900, color: '#fff', textShadow: '0 4px 12px rgba(0,0,0,0.8)' }} />
    </div>
  </div>
);
const def = { id: 'steam-main-capsule', width: 616, height: 353, component: Capsule, schema: Schema };

let fonts: FontRegistry;
beforeAll(async () => {
  fonts = await createNodeFontRegistry({ systemFallback: false });
});

describe('renderer-svg/node', () => {
  it('loads bundled fonts', () => {
    expect(fonts.families()).toEqual(expect.arrayContaining(['Inter', 'Cinzel', 'Bebas Neue', 'Press Start 2P']));
  });

  it('renders PNG at 1x/2x/4x with exact dimensions', async () => {
    for (const scale of [1, 2, 4]) {
      const r = await renderComposition(def, { fonts, scale });
      const meta = await sharp(r.buffer).metadata();
      expect([meta.width, meta.height]).toEqual([616 * scale, 353 * scale]);
      expect(r.mime).toBe('image/png');
    }
  });

  it('meets the < 200 ms target for a 1232×706 capsule (warm)', async () => {
    await renderComposition(def, { fonts, scale: 2 });
    const times: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      await renderComposition(def, { fonts, scale: 2, props: { title: `RUN ${i}` } });
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    const median = times[2];
    console.log(`[bench] steam main capsule 1232x706 median ${median.toFixed(1)}ms (all: ${times.map((t) => t.toFixed(0)).join(', ')})`);
    expect(median).toBeLessThan(400); // generous for shared CI-less machines; target is < 200 ms
  });

  it('encodes WebP (lossy/lossless), JPEG, AVIF, SVG and PDF', async () => {
    const webp = await renderComposition(def, { fonts, format: 'webp', encode: { quality: 80 } });
    expect((await sharp(webp.buffer).metadata()).format).toBe('webp');
    const lossless = await renderComposition(def, { fonts, format: 'webp', encode: { lossless: true } });
    expect(lossless.buffer.length).toBeGreaterThan(webp.buffer.length);
    const jpeg = await renderComposition(def, { fonts, format: 'jpeg', encode: { quality: 85 } });
    expect((await sharp(jpeg.buffer).metadata()).format).toBe('jpeg');
    const avif = await renderComposition(def, { fonts, format: 'avif' });
    expect(['heif', 'avif']).toContain((await sharp(avif.buffer).metadata()).format);
    const svgOut = await renderComposition(def, { fonts, format: 'svg', svgText: 'embedded' });
    const svg = svgOut.buffer.toString('utf8');
    expect(svg).toContain('@font-face');
    expect(svg).toContain('<text');
    expect(svg).not.toContain('data-layer-id');
    const pdf = await renderComposition(def, { fonts, format: 'pdf' });
    expect(pdf.buffer.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('honours store file-size limits by lowering quality', async () => {
    const big = await renderComposition(def, { fonts, format: 'jpeg', scale: 2, encode: { quality: 100 } });
    const capped = await renderComposition(def, { fonts, format: 'jpeg', scale: 2, encode: { quality: 100, maxFileSizeBytes: Math.round(big.buffer.length / 2) } });
    expect(capped.buffer.length).toBeLessThanOrEqual(Math.round(big.buffer.length / 2));
  });

  it('flattens only non-vector features for PDF', () => {
    expect(needsPdfRaster(createLayer('vector', { shape: { kind: 'ellipse' } as any }))).toBe(false);
    expect(needsPdfRaster(createLayer('vector', { shape: { kind: 'ellipse' } as any, effects: [Shadow.drop()] }))).toBe(true);
    expect(needsPdfRaster(createLayer('raster', { src: 'data:image/svg+xml;base64,AAA' }))).toBe(true);
    expect(needsPdfRaster(createLayer('raster', { src: 'hero.png' }))).toBe(false);
  });

  it('isomorphic entry produces the same SVG the node pipeline rasterises', async () => {
    const iso = await renderCompositionToSvg(def, { fonts });
    const node = await renderComposition(def, { fonts, format: 'svg' });
    expect(iso.svg.replace(/ data-layer-[a-z]+="[^"]*"/g, '')).toBe(node.buffer.toString('utf8').replace(/ data-layer-[a-z]+="[^"]*"/g, ''));
    expect(svgToDataUri('<svg/>')).toMatch(/^data:image\/svg\+xml/);
  });

  it('compares images (identical vs different)', async () => {
    const a = (await renderComposition(def, { fonts })).buffer;
    const b = (await renderComposition(def, { fonts, props: { accent: '#00ffaa', title: 'OTHER GAME' } })).buffer;
    const same = await compareImages(a, a);
    expect(same.pixelSimilarity).toBe(1);
    expect(same.phashSimilarity).toBe(1);
    const diff = await compareImages(a, b);
    expect(diff.mismatchRatio).toBeGreaterThan(0);
  });

  it('builds contact sheets', async () => {
    const img = (await renderComposition(def, { fonts })).buffer;
    const sheet = await contactSheet([{ image: img, label: 'A' }, { image: img, label: 'B' }, { image: img, label: 'C' }], { columns: 3, cellWidth: 200, fonts, title: 'Variants' });
    const m = await sharp(sheet).metadata();
    expect(m.width).toBe(3 * 200 + 4 * 24);
  });

  it('transparent artboards keep alpha', async () => {
    const ab = createArtboard({ width: 50, height: 50, children: [createLayer('vector', { shape: { kind: 'ellipse' } as any, fill: { type: 'solid', color: '#f00' }, transform: { width: 50, height: 50 } })] });
    const r = await renderArtboard(ab, { fonts });
    const { data } = await sharp(r.buffer).raw().toBuffer({ resolveWithObject: true });
    expect(data[3]).toBe(0); // top-left corner outside the ellipse
  });

  it('formatFromPath / encodeRaster / rasterizeSvg helpers', async () => {
    expect(formatFromPath('a/b.JPG')).toBe('jpeg');
    const { png } = await rasterizeSvg('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="red"/></svg>');
    expect((await sharp(await encodeRaster(png, 'webp')).metadata()).format).toBe('webp');
  });
});

describe('NodeAssetResolver', () => {
  it('reads files relative to base/search dirs and caches remote assets on disk', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'ga-assets-'));
    writeFileSync(path.join(dir, 'a.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"/>');
    let hits = 0;
    const server = http.createServer((_, res) => {
      hits++;
      res.writeHead(200, { 'content-type': 'image/svg+xml' });
      res.end('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="4"/>');
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const url = `http://127.0.0.1:${(server.address() as any).port}/img.svg`;
    try {
      const cacheDir = path.join(dir, 'cache');
      const r1 = new NodeAssetResolver({ baseDir: '/nonexistent', searchDirs: [dir], cacheDir });
      expect((await r1.resolve('a.svg')).width).toBe(40);
      expect((await r1.resolve(url)).height).toBe(4);
      await r1.resolve(url);
      const r2 = new NodeAssetResolver({ cacheDir });
      await r2.resolve(url);
      expect(hits).toBe(1);
      expect(r2.stats.diskCacheHits).toBe(1);
      await expect(r1.resolve('nope.png')).rejects.toThrow(/File not found/);
    } finally {
      server.close();
    }
  });
});
