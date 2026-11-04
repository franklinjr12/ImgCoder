import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileComposition, flattenLayers, getCompositions, type FontRegistry } from '@game-artisan/core';
import { NodeAssetResolver, createNodeFontRegistry, renderComposition } from '@game-artisan/renderer-svg/node';
import '../src/index.tsx';

const exampleDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const languages = JSON.parse(readFileSync(path.join(exampleDir, 'languages.json'), 'utf8')) as { variants: { id: string; locale: string; props: Record<string, unknown> }[] };
let fonts: FontRegistry;
const assets = new NodeAssetResolver({ baseDir: exampleDir, searchDirs: [path.join(exampleDir, 'assets')], allowRemote: false, cacheDir: false });

beforeAll(async () => {
  fonts = await createNodeFontRegistry();
});

const titleLayer = (layers: ReturnType<typeof flattenLayers>) => layers.find((l) => l.id === 'title-logo' || l.id === 'title') as any;

describe('sci-fi-survivors example', () => {
  const comps = getCompositions();

  it('registers the expected compositions', () => {
    expect(comps.map((c) => c.id).sort()).toEqual(['steam-header', 'steam-library-capsule', 'steam-main', 'steam-vertical', 'twitter-card']);
  });

  it('languages.json covers the required locales in the batch format', () => {
    expect(languages.variants.map((v) => v.locale)).toEqual(expect.arrayContaining(['en', 'de', 'es', 'fr', 'pt-BR', 'ja', 'ko', 'zh-CN']));
    for (const v of languages.variants) expect(v).toEqual({ id: expect.any(String), locale: expect.any(String), props: expect.any(Object) });
  });

  it.each(comps.map((c) => [c.id, c] as const))('%s renders (en + ja)', async (_id, def) => {
    for (const variant of languages.variants.filter((v) => v.id === 'en' || v.id === 'ja')) {
      const out = await renderComposition(def, { fonts, assets, locale: variant.locale, props: variant.props, onMissingAsset: 'error' });
      expect(out.buffer.subarray(1, 4).toString()).toBe('PNG');
      expect([out.width, out.height]).toEqual([def.width, def.height]);
      expect(out.warnings).toEqual([]);
      if (process.env.ARTISAN_PREVIEW_DIR) {
        const { mkdir, writeFile } = await import('node:fs/promises');
        await mkdir(process.env.ARTISAN_PREVIEW_DIR, { recursive: true });
        await writeFile(path.join(process.env.ARTISAN_PREVIEW_DIR, `${def.id}.${variant.id}.png`), out.buffer);
      }
    }
  });

  it('swaps the logo per locale (en / de use the English logo, CJK locales their own)', async () => {
    const def = comps.find((c) => c.id === 'steam-main')!;
    const expected: Record<string, string> = { en: 'logo-en.svg', de: 'logo-en.svg', 'pt-BR': 'logo-en.svg', ja: 'logo-ja.svg', ko: 'logo-ko.svg', 'zh-CN': 'logo-zh-CN.svg' };
    for (const [locale, file] of Object.entries(expected)) {
      const variant = languages.variants.find((v) => v.locale === locale)!;
      const { artboard } = await compileComposition(def, { fonts, assets, locale, props: variant.props });
      const layers = flattenLayers(artboard.children);
      const logo = titleLayer(layers);
      expect(logo.type, locale).toBe('raster');
      expect(logo.src, locale).toBe(`assets/logos/${file}`);
      const tagline = layers.find((l) => l.id === 'tagline') as any;
      expect(tagline.content).toBe(variant.props.tagline);
    }
  });

  it('renders the full batch matrix for the main capsule (8 locales)', async () => {
    const def = comps.find((c) => c.id === 'steam-main')!;
    const results = await Promise.all(languages.variants.map((v) => renderComposition(def, { fonts, assets, locale: v.locale, props: v.props, onMissingAsset: 'error' })));
    for (const r of results) expect(r.warnings).toEqual([]);
    expect(new Set(results.map((r) => r.buffer.length)).size).toBe(results.length);
  });
});
