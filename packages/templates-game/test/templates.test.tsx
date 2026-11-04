import { beforeAll, describe, expect, it } from 'vitest';
import {
  CachingAssetResolver,
  PropsValidationError,
  TextStyleSchema,
  clearRegistry,
  compileComposition,
  defineComposition,
  describeComposition,
  flattenLayers,
  getComposition,
  getCompositions,
  resolveProps,
  type FontRegistry,
  type Layer,
} from '@game-artisan/core';
import { createNodeFontRegistry, renderComposition } from '@game-artisan/renderer-svg/node';
import {
  AgeRatingBlock,
  DemoAvailableBadge,
  GameTemplatesRoot,
  Laurel,
  LocalizedTitle,
  ReviewQuote,
  STORE_PRESETS,
  SaleBadge,
  WishlistCallout,
  builtinArtSvg,
  formatDiscount,
  gameCompositions,
  getPreset,
  listPresets,
  presetSafeZones,
  registerGameTemplates,
  resolveArt,
  resolveTitle,
  type StoreAssetSpec,
} from '@game-artisan/templates-game';

let fonts: FontRegistry;
const assets = new CachingAssetResolver();

beforeAll(async () => {
  fonts = await createNodeFontRegistry();
});

const pngInfo = (buf: Buffer) => ({
  signature: buf.subarray(0, 8).toString('hex'),
  width: buf.readUInt32BE(16),
  height: buf.readUInt32BE(20),
  colorType: buf[25],
});

const textLayers = (layers: Layer[]) => flattenLayers(layers).filter((l): l is Extract<Layer, { type: 'text' }> => l.type === 'text');

// ---------------------------------------------------------------------------------------

describe('STORE_PRESETS', () => {
  const spec: [string, string, number, number, string, StoreAssetSpec['requiredFormat']][] = [
    ['STEAM_HEADER_CAPSULE', 'steam-header-capsule', 460, 215, 'steam', 'png'],
    ['STEAM_MAIN_CAPSULE', 'steam-main-capsule', 616, 353, 'steam', 'png'],
    ['STEAM_VERTICAL_CAPSULE', 'steam-vertical-capsule', 374, 448, 'steam', 'png'],
    ['STEAM_SMALL_CAPSULE', 'steam-small-capsule', 231, 87, 'steam', 'png'],
    ['STEAM_PAGE_BACKGROUND', 'steam-page-background', 1438, 810, 'steam', 'jpeg'],
    ['STEAM_LIBRARY_HERO', 'steam-library-hero', 3840, 1240, 'steam', 'png'],
    ['STEAM_LIBRARY_CAPSULE', 'steam-library-capsule', 600, 900, 'steam', 'png'],
    ['STEAM_LIBRARY_LOGO', 'steam-library-logo', 1280, 720, 'steam', 'png'],
    ['STEAM_COMMUNITY_ICON', 'steam-community-icon-184', 184, 184, 'steam', 'png'],
    ['STEAM_COMMUNITY_ICON_SMALL', 'steam-community-icon-32', 32, 32, 'steam', 'png'],
    ['ITCH_COVER', 'itch-cover', 630, 500, 'itch', 'png'],
    ['ITCH_BANNER', 'itch-banner', 960, 400, 'itch', 'png'],
    ['EPIC_LANDSCAPE', 'epic-landscape', 2560, 1440, 'epic', 'jpeg'],
    ['EPIC_PORTRAIT', 'epic-portrait', 1200, 1600, 'epic', 'png'],
    ['SOCIAL_TWITTER_CARD', 'social-twitter-card', 1200, 675, 'social', 'png'],
    ['SOCIAL_DISCORD_BANNER', 'social-discord-banner', 1920, 1080, 'social', 'png'],
    ['TWITCH_STREAM_OVERLAY', 'twitch-stream-overlay', 1920, 1080, 'social', 'png'],
  ];

  it.each(spec)('%s matches the spec', (key, id, w, h, platform, format) => {
    const p = STORE_PRESETS[key];
    expect(p).toBeDefined();
    expect(p).toMatchObject({ id, width: w, height: h, platform, requiredFormat: format });
  });

  it('keeps the exact spec metadata (aspect ratios, notes, hero safe margins)', () => {
    expect(STORE_PRESETS.STEAM_HEADER_CAPSULE.aspectRatio).toBe('92:43');
    expect(STORE_PRESETS.STEAM_LIBRARY_HERO.aspectRatio).toBe('96:31');
    expect(STORE_PRESETS.STEAM_LIBRARY_HERO.safeZoneMargins).toEqual({ top: 100, right: 200, bottom: 400, left: 200 });
    expect(STORE_PRESETS.STEAM_PAGE_BACKGROUND.notes).toMatch(/#000000/);
  });

  it('covers GOG, Switch and PlayStation platforms', () => {
    for (const platform of ['gog', 'switch', 'playstation', 'itch', 'epic', 'social']) expect(listPresets(platform).length).toBeGreaterThan(0);
    expect(listPresets('steam').every((p) => p.platform === 'steam')).toBe(true);
    expect(listPresets().length).toBe(Object.keys(STORE_PRESETS).length);
  });

  it('ids are unique and every aspect ratio string matches the pixel size', () => {
    const ids = Object.values(STORE_PRESETS).map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of Object.values(STORE_PRESETS)) {
      const [a, b] = p.aspectRatio.split(':').map(Number);
      expect(Math.abs(a / b - p.width / p.height), p.id).toBeLessThan(0.02);
    }
  });

  it('getPreset accepts ids and keys, case-insensitively', () => {
    expect(getPreset('steam-header-capsule')?.width).toBe(460);
    expect(getPreset('STEAM_HEADER_CAPSULE')?.width).toBe(460);
    expect(getPreset('Steam_Main_Capsule')?.id).toBe('steam-main-capsule');
    expect(getPreset('nope')).toBeUndefined();
  });

  it('presetSafeZones: library hero has title-safe area + bottom-left danger zone', () => {
    const zones = presetSafeZones(STORE_PRESETS.STEAM_LIBRARY_HERO);
    const safe = zones.find((z) => z.id === 'title-safe')!;
    expect(safe).toMatchObject({ kind: 'safe', x: 200, y: 100, width: 3440, height: 740 });
    const danger = zones.find((z) => z.kind === 'danger' && z.x === 0 && z.y + z.height === 1240);
    expect(danger).toBeDefined();
    expect(danger!.x + danger!.width).toBeLessThan(3840 / 2);
    for (const z of zones) expect(z).toEqual(expect.objectContaining({ id: expect.any(String), label: expect.any(String), kind: expect.stringMatching(/safe|danger|overlay/) }));
  });

  it('presetSafeZones: page background side fades + content column', () => {
    const zones = presetSafeZones(STORE_PRESETS.STEAM_PAGE_BACKGROUND);
    expect(zones.map((z) => z.id)).toEqual(expect.arrayContaining(['content-column', 'fade-left', 'fade-right']));
    expect(zones.find((z) => z.id === 'content-column')!.width).toBe(940);
  });
});

// ---------------------------------------------------------------------------------------

describe('compositions', () => {
  it('every store preset has a composition with the same id, size and metadata', () => {
    for (const p of Object.values(STORE_PRESETS)) {
      const def = gameCompositions.find((d) => d.id === p.id);
      expect(def, p.id).toBeDefined();
      expect(def).toMatchObject({ width: p.width, height: p.height, preset: p.id, platform: p.platform, defaultFormat: p.requiredFormat });
      expect(Array.isArray(def!.tags)).toBe(true);
      expect(Array.isArray(def!.safeZones)).toBe(true);
    }
    const ids = gameCompositions.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    // variants point at their base preset
    for (const d of gameCompositions) expect(getPreset(d.preset!), d.id).toBeDefined();
  });

  it('GameTemplatesRoot uses folders and registerGameTemplates fills the registry', () => {
    const folders = new Set(gameCompositions.map((d) => d.folder));
    expect(folders).toContain('Steam');
    expect(folders).toContain('Steam/Library');
    expect(GameTemplatesRoot()).toBeTruthy();
    clearRegistry();
    registerGameTemplates();
    expect(getCompositions().length).toBe(gameCompositions.length);
    expect(getComposition('steam-library-hero').width).toBe(3840);
    clearRegistry();
  });

  it('describeComposition exposes widget hints and compact defaults', () => {
    const info = describeComposition(getComposition('steam-main-capsule', gameCompositions));
    const props = (info.propsSchema as any).properties;
    expect(props.accentColor['x-artisan-widget']).toBe('color');
    expect(props.backgroundUrl['x-artisan-widget']).toBe('image');
    expect(props.localeMap['x-artisan-widget']).toBe('locale-map');
    expect(props.grading.enum).toContain('cinematic-dark');
    // built-in art stays a short token in the schema (no megabyte data URIs)
    expect(JSON.stringify(info).length).toBeLessThan(40_000);
  });

  it.each(gameCompositions.map((d) => [d.id, d] as const))('%s renders at the exact preset size', async (_id, def) => {
    const out = await renderComposition(def, { fonts, assets, onMissingAsset: 'error' });
    const png = pngInfo(out.buffer);
    expect(png.signature).toBe('89504e470d0a1a0a');
    expect([png.width, png.height]).toEqual([def.width, def.height]);
    expect(out.warnings).toEqual([]);
  });

  it('library logo and stream overlay are transparent; library hero has no text', async () => {
    for (const id of ['steam-library-logo', 'twitch-stream-overlay']) {
      const { artboard } = await compileComposition(getComposition(id, gameCompositions), { fonts, assets });
      expect(artboard.background, id).toBeUndefined();
    }
    const logo = await renderComposition(getComposition('steam-library-logo', gameCompositions), { fonts, assets, scale: 0.25 });
    expect(pngInfo(logo.buffer).colorType).toBe(6); // RGBA
    const hero = await compileComposition(getComposition('steam-library-hero', gameCompositions), { fonts, assets });
    expect(textLayers(hero.artboard.children)).toHaveLength(0);
    expect(hero.artboard.safeZones.some((z) => z.kind === 'danger')).toBe(true);
  });

  it('page background fades both sides to #000000', async () => {
    const { artboard } = await compileComposition(getComposition('steam-page-background', gameCompositions), { fonts, assets });
    const ids = flattenLayers(artboard.children).map((l) => l.id);
    expect(ids).toEqual(expect.arrayContaining(['fade-left', 'fade-right']));
    const left = flattenLayers(artboard.children).find((l) => l.id === 'fade-left') as any;
    expect(left.fill.stops[0].color).toBe('#000000');
    expect(left.transform.x).toBe(0);
  });

  it('grading + character glow props map to core adjustments/effects', async () => {
    const def = getComposition('steam-main-capsule', gameCompositions);
    const { artboard } = await compileComposition(def, { fonts, assets, props: { grading: 'cinematic-dark', glowIntensity: 80, glowColor: '#00e5ff' } });
    const all = flattenLayers(artboard.children);
    const art = all.find((l) => l.id === 'art')!;
    expect(art.adjustments.map((a) => a.type)).toContain('vignette');
    const ch = all.find((l) => l.id === 'character')!;
    expect(ch.effects[0]).toMatchObject({ type: 'outer-glow', color: '#00e5ff' });
    const off = await compileComposition(def, { fonts, assets, props: { characterGlow: false } });
    expect(flattenLayers(off.artboard.children).find((l) => l.id === 'character')!.effects).toHaveLength(0);
  });

  it('art group is not clip-masked (nested clips + offset SVG images trip a resvg culling bug)', async () => {
    const { artboard } = await compileComposition(getComposition('steam-library-capsule', gameCompositions), { fonts, assets, props: { backgroundFocusX: 0.9 } });
    const art = flattenLayers(artboard.children).find((l) => l.id === 'art') as any;
    expect(art.clipContent).toBe(false);
  });

  it('adaptive capsule picks different layouts per aspect ratio', async () => {
    const title = async (id: string) => {
      const def = getComposition(id, gameCompositions);
      const { artboard } = await compileComposition(def, { fonts, assets });
      const t = textLayers(artboard.children).find((l) => l.id === 'title')!;
      return { t, def, kicker: textLayers(artboard.children).some((l) => l.id === 'kicker') };
    };
    const wide = await title('steam-main-capsule');
    const tall = await title('steam-library-capsule');
    const tiny = await title('steam-small-capsule');
    expect(wide.t.style.textAlign).toBe('left');
    expect(tall.t.style.textAlign).toBe('center');
    expect(tiny.kicker).toBe(false);
    expect(wide.kicker).toBe(true);
    // titles stay inside the canvas
    for (const { t, def } of [wide, tall, tiny]) {
      expect(t.transform.x).toBeGreaterThanOrEqual(0);
      expect(t.transform.x + t.transform.width).toBeLessThanOrEqual(def.width + 1);
      expect(t.transform.y + t.transform.height).toBeLessThanOrEqual(def.height + 1);
    }
  });

  it('renders a 616×353 capsule at scale 2 quickly', async () => {
    const def = getComposition('steam-main-capsule', gameCompositions);
    await renderComposition(def, { fonts, assets, scale: 2 }); // warm-up (yoga, glyph caches)
    const t0 = performance.now();
    const out = await renderComposition(def, { fonts, assets, scale: 2 });
    const ms = performance.now() - t0;
    console.log(`[perf] steam-main-capsule 1232x706 (scale 2): ${ms.toFixed(0)} ms`, out.timings);
    expect([out.width, out.height]).toEqual([1232, 706]);
    expect(ms).toBeLessThan(1500);
  });
});

// ---------------------------------------------------------------------------------------

describe('localization (US-5.4)', () => {
  const hasGlyph = (ch: string, locale: string) => {
    const stack = fonts.resolveStack("'Cinzel', 'Noto Sans CJK JP', 'WenQuanYi Zen Hei', sans-serif", 900, 'normal');
    const f = fonts.fontForChar(ch, stack, locale, 900);
    return !!f && f.font.hasGlyphForCodePoint(ch.codePointAt(0)!);
  };

  it('resolveTitle uses the title prop as the en/default entry with BCP-47 fallback', () => {
    const map = { ja: { text: 'ジャ' }, 'zh-CN': { text: '中文' } };
    expect(resolveTitle(map, { text: 'Game' }, undefined).text).toBe('Game');
    expect(resolveTitle(map, { text: 'Game' }, 'fr').text).toBe('Game');
    expect(resolveTitle(map, { text: 'Game' }, 'ja-JP').text).toBe('ジャ');
    expect(resolveTitle(map, { text: 'Game' }, 'zh').text).toBe('中文');
    expect(resolveTitle(map, { text: 'Game' }, 'ja').cjk).toBe(true);
    expect(resolveTitle({ ko: { logo: 'logo-ko.svg' } }, { text: 'Game' }, 'ko')).toMatchObject({ logo: 'logo-ko.svg' });
  });

  it('--locale ja / zh-CN swaps the title text (and $locale works too)', async () => {
    const def = getComposition('steam-main-capsule', gameCompositions);
    const en = await compileComposition(def, { fonts, assets });
    const ja = await compileComposition(def, { fonts, assets, locale: 'ja' });
    const zh = await compileComposition(def, { fonts, assets, props: { $locale: 'zh-CN' } });
    const title = (a: typeof en) => textLayers(a.artboard.children).find((l) => l.id === 'title')!.content;
    expect(title(en)).toBe('Skybound Relic');
    expect(title(ja)).toMatch(/スカイバウンド/);
    expect(title(zh)).toBe('天穹遗物');
    expect(textLayers(ja.artboard.children).find((l) => l.id === 'kicker')!.content).toBe('アクションアドベンチャー');
  });

  it('a locale logo replaces the text title', async () => {
    const def = getComposition('steam-header-capsule', gameCompositions);
    const { artboard } = await compileComposition(def, { fonts, assets, locale: 'ko', props: { localeMap: { ko: { logo: 'builtin:emblem' } } } });
    const all = flattenLayers(artboard.children);
    expect(all.find((l) => l.id === 'title-logo')?.type).toBe('raster');
    expect(all.find((l) => l.id === 'title')).toBeUndefined();
  });

  it('CJK titles render with real CJK glyphs (skipped without a system CJK font)', async (ctx) => {
    if (!hasGlyph('ス', 'ja') || !hasGlyph('天', 'zh-CN')) {
      console.warn('[skip] no CJK font found on this machine');
      ctx.skip();
    }
    for (const [locale, ch] of [
      ['ja', 'ス'],
      ['zh-CN', '天'],
      ['ko', '스'],
    ] as const) {
      if (!hasGlyph(ch, locale)) continue;
      const def = getComposition('steam-main-capsule', gameCompositions);
      const out = await renderComposition(def, { fonts, assets, locale, format: 'svg' });
      const t = textLayers(out.artboard.children).find((l) => l.id === 'title')!;
      const style = TextStyleSchema.parse(t.style);
      const stack = fonts.resolveStack(style.fontFamily, style.fontWeight, style.fontStyle);
      const face = fonts.fontForChar(ch, stack, locale, style.fontWeight)!;
      expect(face.font.hasGlyphForCodePoint(ch.codePointAt(0)!), `${locale} ${face.family}`).toBe(true);
      expect(face.family).not.toBe('Cinzel');
      expect(out.svg).toContain('<path');
    }
  });
});

// ---------------------------------------------------------------------------------------

describe('props validation', () => {
  it('reports every bad prop with an actionable message', () => {
    const def = getComposition('steam-main-capsule', gameCompositions);
    let err: unknown;
    try {
      resolveProps(def, { accentColor: 'not-a-colour', discount: 150, grading: 'sepia-ish', title: '' });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(PropsValidationError);
    const e = err as PropsValidationError;
    const paths = e.issues.map((i) => i.path);
    expect(paths).toEqual(expect.arrayContaining(['accentColor', 'discount', 'grading', 'title']));
    expect(e.issues.find((i) => i.path === 'accentColor')!.message).toMatch(/CSS colour/);
    expect(e.issues.find((i) => i.path === 'discount')!.message).toMatch(/percentage/);
    expect(e.issues.find((i) => i.path === 'grading')!.expected).toMatch(/cinematic-dark/);
    expect(e.message).toMatch(/steam-main-capsule/);
  });

  it('rejects malformed localeMap entries', () => {
    const def = getComposition('steam-main-capsule', gameCompositions);
    expect(() => resolveProps(def, { localeMap: { ja: { txt: 'typo' } } })).toThrow(PropsValidationError);
    expect(() => resolveProps(def, { localeMap: { ja: { text: 'OK', logo: 'assets/logo-ja.svg' } } })).not.toThrow();
  });

  it('library hero keeps the character out of the logo safe zone', () => {
    const def = getComposition('steam-library-hero', gameCompositions);
    expect(() => resolveProps(def, { characterPosition: 0.2 })).toThrow(/logo safe zone/);
  });
});

// ---------------------------------------------------------------------------------------

describe('components', () => {
  it('built-in art resolves to self-contained SVG data URIs', () => {
    expect(resolveArt('builtin:hero')).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(resolveArt('assets/x.png')).toBe('assets/x.png');
    expect(resolveArt('')).toBeUndefined();
    expect(builtinArtSvg('sky-mountains')).not.toMatch(/<text/);
    expect(() => resolveArt('builtin:missing')).toThrow(/Available/);
  });

  it('formatDiscount', () => {
    expect(formatDiscount(50)).toBe('-50%');
    expect(formatDiscount('75')).toBe('-75%');
    expect(formatDiscount('FREE')).toBe('FREE');
  });

  it('badges, laurels, quotes, ratings and localized titles compile and render', async () => {
    const Sheet = () => (
      <div style={{ width: 1200, height: 800, backgroundColor: '#1a1530' }}>
        {(['classic', 'modern', 'pixel'] as const).map((s, i) => (
          <Laurel key={s} x={20 + i * 260} y={20} width={240} text="Official selection" title="Pixel Harbor Fest" year={2026} leafStyle={s} />
        ))}
        {(['burst', 'tag', 'ribbon', 'circle', 'pill'] as const).map((s, i) => (
          <SaleBadge key={s} x={20 + i * 170} y={220} size={150} discount={40 + i * 10} label="Sale" shape={s} />
        ))}
        <WishlistCallout x={20} y={420} width={300} subtext="Coming 2026" />
        <DemoAvailableBadge x={340} y={420} width={300} variant="outline" />
        <ReviewQuote x={660} y={400} width={500} quote="A breathtaking climb through a sky full of secrets." outlet="Indie Gazette" score="9/10" stars={4.5} />
        <AgeRatingBlock x={20} y={560} size={140} system="PEGI" rating="12" descriptors={['Fantasy violence', 'In-game purchases']} />
        <AgeRatingBlock x={400} y={560} size={140} system="ESRB" rating="T" />
        <AgeRatingBlock x={540} y={560} size={140} system="USK" rating="12" />
        <LocalizedTitle x={700} y={580} width={480} height={160} text="Skybound Relic" localeMap={{ ja: { text: 'スカイバウンド' } }} />
      </div>
    );
    const def = defineComposition({ id: 'component-sheet', width: 1200, height: 800, component: Sheet });
    const out = await renderComposition(def, { fonts, assets, locale: 'ja' });
    expect(pngInfo(out.buffer)).toMatchObject({ width: 1200, height: 800 });
    if (process.env.ARTISAN_PREVIEW_DIR) {
      const { writeFile, mkdir } = await import('node:fs/promises');
      await mkdir(process.env.ARTISAN_PREVIEW_DIR, { recursive: true });
      await writeFile(`${process.env.ARTISAN_PREVIEW_DIR}/_components.png`, out.buffer);
    }
    const all = flattenLayers(out.artboard.children);
    expect(all.filter((l) => l.name === 'Leaves')).toHaveLength(3);
    expect(textLayers(out.artboard.children).map((t) => t.content)).toEqual(expect.arrayContaining(['-40%', 'PEGI', 'ESRB', 'USK', '— Indie Gazette', 'スカイバウンド']));
    // rating blocks are generic placeholders: plain rect + text, no images
    expect(all.filter((l) => l.name?.startsWith('Age rating')).every((g) => flattenLayers((g as any).children).every((c) => c.type !== 'raster' && c.type !== 'svg'))).toBe(true);
  });
});
