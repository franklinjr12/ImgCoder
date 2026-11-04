import { beforeAll, describe, expect, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileComposition, flattenLayers, getCompositions, type FontRegistry } from '@game-artisan/core';
import { NodeAssetResolver, createNodeFontRegistry, renderComposition } from '@game-artisan/renderer-svg/node';
import '../src/index.tsx';

const exampleDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let fonts: FontRegistry;
const assets = new NodeAssetResolver({ baseDir: exampleDir, searchDirs: [path.join(exampleDir, 'assets')], allowRemote: false, cacheDir: false });

beforeAll(async () => {
  fonts = await createNodeFontRegistry();
});

describe('retro-pixel-rpg example', () => {
  const comps = getCompositions();

  it('registers the expected compositions', () => {
    expect(comps.map((c) => c.id).sort()).toEqual(['itch-cover', 'itch-cover-gameboy', 'steam-header', 'steam-main', 'steam-main-sale']);
  });

  it.each(comps.map((c) => [c.id, c] as const))('%s renders with project assets', async (_id, def) => {
    const out = await renderComposition(def, { fonts, assets, onMissingAsset: 'error' });
    expect(out.buffer.subarray(1, 4).toString()).toBe('PNG');
    expect([out.width, out.height]).toEqual([def.width, def.height]);
    expect(out.warnings).toEqual([]);
    if (process.env.ARTISAN_PREVIEW_DIR) {
      const { mkdir, writeFile } = await import('node:fs/promises');
      await mkdir(process.env.ARTISAN_PREVIEW_DIR, { recursive: true });
      await writeFile(path.join(process.env.ARTISAN_PREVIEW_DIR, `${def.id}.png`), out.buffer);
    }
  });

  it('uses pixel-art rendering, retro filters and the pixel font', async () => {
    const def = comps.find((c) => c.id === 'itch-cover-gameboy')!;
    const { artboard } = await compileComposition(def, { fonts, assets });
    const layers = flattenLayers(artboard.children);
    const bg = layers.find((l) => l.id === 'background') as any;
    expect(bg.rendering).toBe('pixelated');
    const art = layers.find((l) => l.id === 'art')!;
    expect(art.adjustments).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'pixelate' }), expect.objectContaining({ type: 'palette', preset: 'gameboy' })]));
    expect(layers.find((l) => l.id === 'screen')!.adjustments.map((a) => a.type)).toEqual(expect.arrayContaining(['scanlines', 'chromatic-aberration', 'vignette']));
    expect(layers.some((l) => l.type === 'halftone')).toBe(true);
    const title = layers.find((l) => l.id === 'title') as any;
    expect(title.style.fontFamily).toMatch(/Press Start 2P/);
  });
});
