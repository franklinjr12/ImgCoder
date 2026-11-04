import { describe, expect, it, beforeEach } from 'vitest';
import { z } from 'zod';
import {
  Composition, Folder, Layer, Text, VectorImage, registerRoot, registerCompositions, clearRegistry, getCompositions, getComposition, describeComposition,
  compileComposition, compileElement, resolveProps, PropsValidationError, CachingAssetResolver, applyOverrides, mergeOverrides, zColor, zImage,
  getLocale, resolveLocale, renderArtboardToSvg, documentToTemplateCode, propsToJson, diffProps, compositionFromDocument, createDocument, createArtboard, createLayer,
  Filters, Shadow, gradingPreset, findLayer,
} from '@game-artisan/core';
import { testFonts, SVG_IMG } from './helpers.js';

const fonts = testFonts();
const assets = new CachingAssetResolver();

const Schema = z.object({ title: z.string().default('CHRONO BLADE'), accent: zColor('#ff3366'), heroX: z.number().default(400), bg: zImage(SVG_IMG), showBadge: z.boolean().default(true), size: z.enum(['s', 'l']).default('l') });

function Capsule(p: z.infer<typeof Schema>) {
  const loc = resolveLocale({ en: 'PLAY NOW', ja: '今すぐプレイ' }, getLocale());
  return (
    <div style={{ width: 616, height: 353, backgroundColor: '#0a0a0c', fontFamily: 'Inter' }}>
      <Layer.Image id="bg" src={p.bg} width={616} height={353} style={{ filter: 'contrast(1.1) brightness(0.9) drop-shadow(0 0 10px #f00)' }} />
      <Layer.Gradient type="radial" cx="70%" cy="50%" radius="60%" colors={[`${p.accent}44`, 'transparent']} blendMode="screen" />
      <Layer.Image id="hero" src={p.bg} x={p.heroX} y={20} height={300} bind={{ x: 'heroX' }} effects={[Shadow.glow(p.accent)]} />
      {p.showBadge && <Layer.Star id="badge" x={10} y={10} width={60} height={60} fill="gold" points={8} />}
      <div style={{ position: 'absolute', left: 24, bottom: 24, maxWidth: 380 }}>
        <Text id="cta" content={loc} style={{ fontSize: 10, fontWeight: 700, color: p.accent, letterSpacing: 2, marginBottom: 4 }} />
        <Text id="title" content={p.title} style={{ fontSize: 34, fontWeight: 900, color: '#fff', textShadow: '0 4px 12px rgba(0,0,0,0.8)' }} strokes={[{ width: 2, color: '#000', cap: 'round', join: 'round', align: 'outside' }]} />
      </div>
    </div>
  );
}

beforeEach(() => clearRegistry());

describe('composition registry', () => {
  it('collects <Composition/> declarations (incl. folders) from registerRoot', () => {
    registerRoot(() => (
      <>
        <Folder name="Steam">
          <Composition id="steam-main" width={616} height={353} component={Capsule} schema={Schema} defaultProps={{ title: 'X' }} platform="steam" />
        </Folder>
        <Composition id="other" width={100} height={100} component={() => <div />} />
      </>
    ));
    registerCompositions({ id: 'prog', width: 10, height: 10, component: () => null });
    const list = getCompositions();
    expect(list.map((c) => c.id).sort()).toEqual(['other', 'prog', 'steam-main']);
    expect(getComposition('steam-main').folder).toBe('Steam');
    expect(() => getComposition('steam-mian')).toThrow(/Did you mean: steam-main/);
    const info = describeComposition(getComposition('steam-main'));
    expect((info.propsSchema as any).properties.accent['x-artisan-widget']).toBe('color');
    expect((info.propsSchema as any).properties.bg['x-artisan-widget']).toBe('image');
  });

  it('validates props with agent-friendly errors', () => {
    const def = { id: 'c', width: 10, height: 10, component: Capsule, schema: Schema };
    expect(resolveProps(def, { title: 'A' }).accent).toBe('#ff3366');
    try {
      resolveProps(def, { heroX: 'left', size: 'xl' });
      throw new Error('should fail');
    } catch (e) {
      expect(e).toBeInstanceOf(PropsValidationError);
      const err = e as PropsValidationError;
      expect(err.issues.map((i) => i.path).sort()).toEqual(['heroX', 'size']);
      expect(err.message).toMatch(/artisan inspect c/);
      expect(err.toJSON().propsSchema).toBeTruthy();
    }
  });
});

describe('JSX → UDM compiler', () => {
  const def = { id: 'cap', width: 616, height: 353, component: Capsule, schema: Schema };

  it('lays out flexbox/absolute elements like the spec sample', async () => {
    const { artboard } = await compileComposition(def, { fonts, assets });
    expect(artboard.width).toBe(616);
    expect(artboard.background).toEqual({ type: 'solid', color: '#0a0a0c' });
    const bg = findLayer(artboard, 'bg')!.layer;
    expect(bg.transform).toMatchObject({ x: 0, y: 0, width: 616, height: 353 });
    expect(bg.adjustments.map((a) => a.type)).toEqual(['contrast', 'brightness']);
    expect(bg.effects[0].type).toBe('drop-shadow');
    const hero = findLayer(artboard, 'hero')!.layer;
    expect(hero.transform.x).toBe(400);
    expect(hero.transform.height).toBe(300);
    expect(hero.transform.width).toBeCloseTo(600); // aspect ratio from intrinsic 200x100
    expect(hero.bindings).toEqual({ 'transform.x': 'heroX' });
    const title = findLayer(artboard, 'title')!;
    const cta = findLayer(artboard, 'cta')!;
    expect(title.parent?.type).toBe('group');
    expect(title.layer.transform.y).toBeGreaterThan(cta.layer.transform.y + cta.layer.transform.height); // stacked with margin
    const group = title.parent!;
    expect(group.transform.y + group.transform.height).toBeCloseTo(353 - 24, 3); // bottom: 24
    expect((title.layer as any).style.strokes).toHaveLength(1);
    expect(title.layer.effects[0].type).toBe('drop-shadow');
    const grad = artboard.children.find((l) => l.type === 'vector' && l.blendMode === 'screen') as any;
    expect(grad.fill.type).toBe('radial-gradient');
    expect(grad.fill.stops[0].color).toBe('#ff336644');
  });

  it('keeps ids stable when conditional layers toggle', async () => {
    const a = await compileComposition(def, { fonts, assets, props: { showBadge: true } });
    const b = await compileComposition(def, { fonts, assets, props: { showBadge: false } });
    const ids = (ab: any) => ab.children.map((l: any) => l.id).filter((id: string) => id !== 'badge');
    expect(ids(a.artboard)).toEqual(ids(b.artboard));
  });

  it('applies $overrides and locale from props meta', async () => {
    const { artboard } = await compileComposition(def, { fonts, assets, props: { $overrides: { hero: { transform: { y: 99 }, opacity: 0.5 } }, $locale: 'ja' } });
    const hero = findLayer(artboard, 'hero')!.layer;
    expect(hero.transform.y).toBe(99);
    expect(hero.opacity).toBe(0.5);
    expect((findLayer(artboard, 'cta')!.layer as any).content).toBe('今すぐプレイ');
    expect(artboard.locale).toBe('ja');
  });

  it('rejects hooks / unsupported elements with clear errors', async () => {
    await expect(compileElement(<svg />, { fonts, width: 10, height: 10 })).rejects.toThrow(/VectorImage/);
  });
});

describe('SVG emitter', () => {
  it('emits annotated layers, filters, gradients and outlined text', async () => {
    const { artboard } = await compileComposition({ id: 'cap', width: 616, height: 353, component: Capsule, schema: Schema }, { fonts, assets });
    const { svg, width } = await renderArtboardToSvg(artboard, { fonts, assets, scale: 2 });
    expect(width).toBe(1232);
    expect(svg).toContain('viewBox="0 0 616 353"');
    expect(svg).toContain('data-layer-id="hero"');
    expect(svg).toMatch(/<filter[^>]+color-interpolation-filters="sRGB"/);
    expect(svg).toContain('feGaussianBlur');
    expect(svg).toContain('radialGradient');
    expect(svg).toContain('mix-blend-mode:screen');
    expect(svg).not.toContain('<text');
  });

  it('supports live text with embedded fonts, clipping masks, masks, booleans, halftone and patterns', async () => {
    const ab = createArtboard({
      width: 200,
      height: 100,
      children: [
        createLayer('vector', { id: 'base', shape: { kind: 'ellipse' } as any, transform: { width: 100, height: 100 } }),
        createLayer('vector', { id: 'clipped', clippingMask: true, shape: { kind: 'rect', cornerRadius: 0 } as any, transform: { width: 200, height: 50 } }),
        createLayer('text', { id: 'live', content: 'Hello', style: { fontSize: 20 } as any, transform: { width: 100, height: 30 } }),
        createLayer('boolean', { id: 'bool', operation: 'subtract', transform: { width: 100, height: 100 }, children: [createLayer('vector', { shape: { kind: 'rect', cornerRadius: 0 } as any, transform: { width: 100, height: 100 } }), createLayer('vector', { shape: { kind: 'ellipse' } as any, transform: { x: 25, y: 25, width: 50, height: 50 } })] } as any),
        createLayer('halftone', { id: 'ht', transform: { width: 100, height: 100 }, spacing: 10 }),
        createLayer('pattern', { id: 'pat', pattern: 'scanlines', transform: { width: 100, height: 100 } }),
        createLayer('mask', { id: 'm', mask: createLayer('vector', { shape: { kind: 'ellipse' } as any, transform: { width: 50, height: 50 } }), transform: { width: 100, height: 100 }, children: [createLayer('vector', { shape: { kind: 'rect', cornerRadius: 0 } as any, transform: { width: 100, height: 100 } })] } as any),
        createLayer('svg', { id: 'icon', markup: '<svg viewBox="0 0 10 10"><script>alert(1)</script><rect id="r" width="10" height="10" onclick="x()"/></svg>', color: '#ff0', transform: { width: 20, height: 20 } }),
      ],
    });
    const { svg } = await renderArtboardToSvg(ab, { fonts, textMode: 'text' });
    expect(svg).toContain('mask-type="alpha"');
    expect(svg).toContain('@font-face');
    expect(svg).toContain('>Hello</text>');
    expect(svg).toContain('<pattern');
    expect(svg).not.toContain('<script');
    expect(svg).not.toContain('onclick');
    expect(svg).toMatch(/id="ga-icon-r"/);
  });

  it('reports missing assets with a placeholder instead of crashing', async () => {
    const ab = createArtboard({ width: 10, height: 10, children: [createLayer('raster', { src: 'missing.png' })] });
    const r = await renderArtboardToSvg(ab, { fonts, assets: new CachingAssetResolver() });
    expect(r.warnings[0]).toMatch(/Asset not found: missing.png/);
  });
});

describe('overrides, codegen, presets', () => {
  it('merges overrides deeply', () => {
    const m = mergeOverrides({ a: { transform: { x: 1 } } }, { a: { transform: { y: 2 }, opacity: 0.5 } });
    expect(m.a).toEqual({ transform: { x: 1, y: 2 }, opacity: 0.5 });
    const ab = createArtboard({ width: 10, height: 10, children: [createLayer('text', { id: 't', content: 'a', style: {} as any })] });
    expect((applyOverrides(ab, { t: { content: 'b', style: { fontSize: 99 } } }).children[0] as any).style.fontSize).toBe(99);
  });
  it('generates template code and props JSON', () => {
    const d = createDocument({ name: 'My Banner', artboards: [createArtboard({ width: 10, height: 10 })] });
    const code = documentToTemplateCode(d);
    expect(code).toContain('export const MyBannerComposition = compositionFromDocument(');
    expect(JSON.parse(propsToJson({ a: 1 }, { l: { opacity: 0 } })).$overrides.l.opacity).toBe(0);
    expect(diffProps({ a: 1, b: { c: 2 } }, { a: 1, b: { c: 3 } })).toEqual(['b.c']);
    expect(compositionFromDocument(d).width).toBe(10);
  });
  it('exposes grading presets and filter builders', () => {
    expect(gradingPreset('cinematic-dark').some((a) => a.type === 'vignette')).toBe(true);
    expect(() => gradingPreset('nope')).toThrow(/Available/);
    expect(Filters.retroPixel(4, 'gameboy')).toEqual([{ type: 'pixelate', size: 4 }, { type: 'palette', preset: 'gameboy' }]);
  });
});
