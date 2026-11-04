/**
 * Lanternmoor — retro pixel-art RPG marketing kit.
 *
 * Shows: Press Start 2P typography, Filters.retroPixel (pixelate + palette reduction incl. the
 * GameBoy 4-colour palette), scanline / CRT shaders, a vector halftone layer, pixelated image
 * rendering, and templates-game components (pixel Laurel, SaleBadge, LocalizedTitle).
 */
import { Composition, Filters, Folder, Layer, Shadow, Text, getRenderContext, registerRoot, z, zSlider } from '@game-artisan/core';
import { Laurel, LocalizedTitle, SaleBadge, Scrim, TitleLocaleMapSchema, colorProp, imageProp, presetCompositionProps, resolveTitle, withCjkFallback } from '@game-artisan/templates-game';

const PIXEL_FONT = 'Press Start 2P';

export const PixelCapsuleSchema = z.object({
  title: z.string().min(1).max(40).default('Lanternmoor'),
  kicker: z.string().max(32).default('A 16-bit quest'),
  tagline: z.string().max(80).default('Carry the last light through the moonlit ruins.'),
  localeMap: TitleLocaleMapSchema.default({
    ja: { text: 'ランタンムーア', kicker: '16ビットの冒険', tagline: '月夜の廃墟に最後の灯をともせ。' },
    de: { kicker: 'Ein 16-Bit-Abenteuer', tagline: 'Trage das letzte Licht durch die mondbeschienenen Ruinen.' },
  }),
  backgroundUrl: imageProp('assets/backgrounds/moonlit-ruins.svg', 'Pixel-art background'),
  characterUrl: imageProp('assets/characters/lantern-knight.svg', 'Pixel-art hero sprite'),
  emblemUrl: imageProp('assets/logos/lantern-emblem.svg', 'Pixel emblem next to the title'),
  palette: z.enum(['full', '16-color', 'gameboy', 'gameboy-pocket', 'cga', 'sepia-4']).default('full').describe('Palette reduction applied to the artwork (full = 512 colours)'),
  pixelSize: zSlider(1, 8, 2).describe('Pixelation grid size (px)'),
  crt: z.boolean().default(true).describe('CRT shader: scanlines, RGB split, bloom, vignette'),
  crtIntensity: zSlider(0, 1, 0.6, 0.05),
  halftone: z.boolean().default(true).describe('Vector halftone shading behind the title'),
  accentColor: colorProp('#ffcd75', 'Title / accent colour'),
  shadowColor: colorProp('#1a1c2c', 'Hard pixel shadow colour'),
  discount: z.number().int().min(0).max(95).default(0).describe('Sale percentage (0 hides the badge)'),
  eventBanner: z.string().max(40).default(''),
  laurelTitle: z.string().max(32).default(''),
  laurelYear: z.string().max(8).default(''),
});

export type PixelCapsuleProps = z.infer<typeof PixelCapsuleSchema>;

function paletteAdjustments(p: PixelCapsuleProps) {
  // Filters.retroPixel: pixelate + palette reduction (16-colour posterize or a fixed palette).
  if (p.palette === 'full') return Filters.retroPixel(p.pixelSize, 512);
  if (p.palette === '16-color') return Filters.retroPixel(p.pixelSize, 16);
  return Filters.retroPixel(p.pixelSize, p.palette);
}

/** Adaptive pixel-art capsule (wide: title left; square/tall: title on top). */
export function PixelCapsule(p: PixelCapsuleProps) {
  const { width: W, height: H } = getRenderContext();
  const wide = W / H >= 1.45;
  const u = Math.min(W, H) / 100;
  const t = resolveTitle(p.localeMap, { text: p.title, kicker: p.kicker || undefined, tagline: p.tagline || undefined });
  const bannerH = p.eventBanner ? Math.round(u * 9) : 0;
  const m = Math.round(u * 6);
  // hero sprite: 24×30 → keep integer-ish scale so pixels stay square
  const chH = wide ? H * 0.7 : H * 0.56;
  const chW = chH * 0.8;
  const chX = wide ? W * 0.74 - chW / 2 : W * 0.5 - chW / 2;
  const chY = H * 0.93 - chH;
  const titleBox = wide
    ? { x: m * 1.4, y: bannerH + m, width: W * 0.56, height: H - bannerH - m * 2 }
    : { x: m, y: bannerH + m, width: W - m * 2, height: H * 0.4 };
  const titleH = wide ? titleBox.height * 0.42 : titleBox.height * 0.5;
  const hardShadow = Shadow.drop({ x: u * 0.8, y: u * 0.8, blur: 0, color: p.shadowColor, opacity: 1 });
  const screenFx = p.crt ? Filters.crt(p.crtIntensity) : [];
  return (
    <div style={{ width: W, height: H, backgroundColor: '#140c1c', overflow: 'hidden' }}>
      <Layer.Group id="screen" name="CRT screen" adjustments={screenFx} x={0} y={0} width={W} height={H}>
        <Layer.Group id="art" name="Art (palette reduced)" adjustments={paletteAdjustments(p)} x={0} y={0} width={W} height={H}>
          <Layer.Image id="background" name="Background" src={p.backgroundUrl} fit="cover" position={{ x: 0.5, y: 1 }} rendering="pixelated" x={0} y={0} width={W} height={H} />
          <Layer.Image
            id="character"
            name="Hero sprite"
            src={p.characterUrl}
            fit="contain"
            position={{ x: 0.5, y: 1 }}
            rendering="pixelated"
            x={chX}
            y={chY}
            width={chW}
            height={chH}
            effects={[Shadow.outline(p.shadowColor, Math.max(1, u * 0.4)), Shadow.glow('#ffcd75', { radius: u * 0.3, blur: u * 2, opacity: 0.45 })]}
          />
        </Layer.Group>
        {p.halftone ? (
          // Comic-style vector halftone: dots grow towards the title side.
          <Layer.Halftone id="halftone" name="Halftone" dot="square" spacing={Math.max(4, Math.round(u * 1.6))} angle={0} gradientAngle={wide ? 270 : 0} minSize={0} maxSize={0.85} color="#140c1c" opacity={0.45} blendMode="multiply" />
        ) : null}
        <Scrim id="scrim" angle={wide ? 90 : 180} extent={wide ? 0.7 : 0.6} strength={0.7} color="#140c1c" />
        <div className="Title block" style={{ position: 'absolute', left: titleBox.x, top: titleBox.y, width: titleBox.width, height: titleBox.height, flexDirection: 'column', justifyContent: wide ? 'center' : 'flex-start', alignItems: wide ? 'flex-start' : 'center', gap: u * 2.4 }}>
          <div className="Kicker row" style={{ flexDirection: 'row', alignItems: 'center', gap: u * 1.6 }}>
            <Layer.Image id="emblem" name="Emblem" src={p.emblemUrl} rendering="pixelated" fit="contain" style={{ width: u * 7, height: u * 7 }} effects={[hardShadow]} />
            {t.kicker ? <Text id="kicker" name="Kicker" content={t.kicker} effects={[hardShadow]} style={{ fontFamily: withCjkFallback(PIXEL_FONT), fontSize: Math.max(6, Math.round(u * 3.2)), color: '#94b0c2', textTransform: 'uppercase', whiteSpace: 'nowrap' }} /> : null}
          </div>
          <LocalizedTitle
            localeMap={p.localeMap}
            text={p.title}
            width={titleBox.width}
            height={titleH}
            style={{ position: 'relative' }}
            fontFamily={PIXEL_FONT}
            fontWeight={400}
            color={p.accentColor}
            textAlign={wide ? 'left' : 'center'}
            textTransform="uppercase"
            lineHeight={1.25}
            strokes={[{ color: p.shadowColor, width: Math.max(1, u * 0.6), cap: 'butt', join: 'miter', align: 'outside' }]}
            effects={[hardShadow]}
          />
          {t.tagline ? (
            <Text id="tagline" name="Tagline" content={t.tagline} maxLines={2} effects={[hardShadow]} style={{ width: titleBox.width, fontFamily: withCjkFallback(PIXEL_FONT), fontSize: Math.max(6, Math.round(u * 2.6)), lineHeight: 1.6, color: '#f4f4f4', textAlign: wide ? 'left' : 'center' }} />
          ) : null}
        </div>
        {p.laurelTitle ? <Laurel x={wide ? m * 1.2 : W - W * 0.3 - m} y={bannerH + m * 0.4} width={wide ? W * 0.2 : W * 0.3} leafStyle="pixel" text="Winner" title={p.laurelTitle} year={p.laurelYear} color="#ffcd75" fontFamily={PIXEL_FONT} effects={[hardShadow]} /> : null}
        {p.discount > 0 ? <SaleBadge x={W - u * 34 - m} y={H - u * 13 - m} size={u * 34} shape="ribbon" discount={p.discount} label="Sale" color="#b13e53" fontFamily={PIXEL_FONT} effects={[hardShadow]} rotation={0} /> : null}
        {/* scanlines as an explicit pattern layer (in addition to the CRT shader) */}
        {p.crt ? <Layer.Pattern id="scanlines" name="Scanlines" pattern="scanlines" spacing={Math.max(2, Math.round(u * 0.9))} thickness={Math.max(1, Math.round(u * 0.3))} color="rgba(0,0,0,0.18)" /> : null}
      </Layer.Group>
      {p.eventBanner ? (
        <Layer.Group id="event-banner" name="Event banner" x={0} y={0} width={W} height={bannerH} fill="#b13e53">
          <Text name="Event banner text" content={p.eventBanner} fit="shrink" maxLines={1} style={{ position: 'absolute', left: m, top: 0, width: W - m * 2, height: bannerH, fontFamily: withCjkFallback(PIXEL_FONT), fontSize: bannerH * 0.42, color: '#ffffff', textAlign: 'center', verticalAlign: 'middle', textTransform: 'uppercase' }} />
        </Layer.Group>
      ) : null}
    </div>
  );
}

const comp = (presetKey: string, id: string, tags: string[], defaultProps: Partial<z.input<typeof PixelCapsuleSchema>> = {}, name?: string) => {
  const base = presetCompositionProps(presetKey);
  return <Composition key={id} {...base} id={id} name={name ?? base.name} component={PixelCapsule} schema={PixelCapsuleSchema} defaultProps={defaultProps} tags={['pixel-art', ...tags]} />;
};

registerRoot(() => (
  <>
    <Folder name="Steam">
      {comp('STEAM_HEADER_CAPSULE', 'steam-header', ['steam', 'capsule'], { tagline: '' })}
      {comp('STEAM_MAIN_CAPSULE', 'steam-main', ['steam', 'capsule'])}
      {comp('STEAM_MAIN_CAPSULE', 'steam-main-sale', ['steam', 'sale'], { discount: 40, eventBanner: 'Summer quest sale', laurelTitle: 'Retro Jam', laurelYear: '2026', tagline: '' }, 'Steam Main Capsule — Sale')}
    </Folder>
    <Folder name="Itch.io">
      {comp('ITCH_COVER', 'itch-cover', ['itch', 'cover'])}
      {comp('ITCH_COVER', 'itch-cover-gameboy', ['itch', 'cover', 'gameboy'], { palette: 'gameboy', pixelSize: 3 }, 'Itch.io Cover — GameBoy palette')}
    </Folder>
  </>
));
