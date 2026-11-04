/**
 * Studio sample compositions — always available (even without a project or
 * @game-artisan/templates-game) so the editor has something to show and the e2e smoke test has
 * a stable target. They exercise bindings (`bind`), widgets and effects.
 */
import { Layer, Shadow, Text, VectorImage, defineComposition, z, zColor, zFont, zSlider, type CompositionDefinition } from '@game-artisan/core';

const MOUNTAINS = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 616 163"><path d="M0 120 L70 62 L120 96 L190 30 L262 104 L318 70 L380 118 L452 48 L530 112 L616 74 L616 163 L0 163Z" fill="#000" fill-opacity="0.55"/><path d="M0 140 L90 104 L160 132 L240 92 L330 140 L420 108 L500 142 L616 116 L616 163 L0 163Z" fill="#000" fill-opacity="0.8"/></svg>`;

const HERO = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 300"><path d="M100 18c22 0 38 17 38 40 0 14-6 26-16 33l34 22c14 9 22 26 24 44l10 143H10l10-143c2-18 10-35 24-44l34-22c-10-7-16-19-16-33 0-23 16-40 38-40z" fill="#0d0f1a"/><path d="M62 70c8-30 68-30 76 0-10-8-24-12-38-12s-28 4-38 12z" fill="#1d2240"/><rect x="78" y="62" width="16" height="5" rx="2" fill="#7ff" /><rect x="106" y="62" width="16" height="5" rx="2" fill="#7ff"/><path d="M168 30 L178 34 L120 210 L112 206Z" fill="#cfe9ff"/><path d="M112 206 L120 210 L114 228 L106 224Z" fill="#c9a24a"/></svg>`;

const THEMES = {
  night: ['#0b1030', '#3a0e5c'],
  sunset: ['#2b0f2e', '#ff6a3d'],
  toxic: ['#03140b', '#0f6b3a'],
} as const;

export const DemoCapsuleSchema = z.object({
  title: z.string().default('NEON HORIZON'),
  tagline: z.string().default('A CYBERPUNK ROGUE-LITE'),
  accentColor: zColor('#00ffaa'),
  theme: z.enum(['night', 'sunset', 'toxic']).default('night'),
  titleFont: zFont('Cinzel'),
  heroX: z.number().default(372),
  heroY: z.number().default(40),
  heroScale: zSlider(50, 150, 100),
  showBadge: z.boolean().default(true),
  discount: zSlider(5, 90, 33),
});
type DemoProps = z.infer<typeof DemoCapsuleSchema>;

function DemoCapsule(p: DemoProps) {
  const [c0, c1] = THEMES[p.theme];
  const s = p.heroScale / 100;
  return (
    <div style={{ width: 616, height: 353, backgroundColor: c0, overflow: 'hidden' }}>
      <Layer.Gradient id="sky" name="Sky" type="linear" angle={180} colors={[c0, c1]} />
      <Layer.Ellipse id="sun" name="Glow orb" x={360} y={30} width={220} height={220} fill={p.accentColor} opacity={0.22} effects={[Shadow.glow(p.accentColor, { radius: 8, blur: 40, opacity: 0.8 })]} />
      <VectorImage id="mountains" name="Mountains" x={0} y={190} width={616} height={163} markup={MOUNTAINS} fit="fill" />
      <Layer.Halftone id="halftone" name="Halftone" spacing={8} color="rgba(0,0,0,0.35)" gradientAngle={0} blendMode="multiply" />
      <VectorImage
        id="hero"
        name="Hero"
        x={p.heroX}
        y={p.heroY}
        width={Math.round(200 * s)}
        height={Math.round(300 * s)}
        markup={HERO}
        bind={{ x: 'heroX', y: 'heroY' }}
        effects={[Shadow.rimLight(p.accentColor, { width: 3, blur: 2 }), Shadow.drop({ y: 10, blur: 18, color: 'rgba(0,0,0,0.7)' })]}
      />
      <Layer.Gradient id="shade" name="Bottom shade" type="linear" angle={180} colors={['rgba(5,5,12,0)', 'rgba(5,5,12,0.92)']} stops={[0.45, 1]} />
      <Text id="tagline" name="Tagline" content={p.tagline} style={{ position: 'absolute', left: 30, top: 222, width: 420, fontSize: 13, fontWeight: 700, letterSpacing: 3, color: p.accentColor }} />
      <Text
        id="title"
        name="Title"
        content={p.title}
        style={{ position: 'absolute', left: 28, top: 246, width: 400, fontFamily: p.titleFont, fontSize: 50, fontWeight: 900, lineHeight: 1, color: '#ffffff' }}
        strokes={[{ color: '#000000', width: 3, align: 'outside' } as any]}
        effects={[Shadow.drop({ y: 4, blur: 10, color: 'rgba(0,0,0,0.8)' })]}
      />
      {p.showBadge ? (
        <Layer.Group id="badge" name="Sale badge" x={500} y={20} width={96} height={96} rotation={-8}>
          <Layer.Star id="badge-star" name="Badge burst" points={14} innerRatio={0.84} fill="#ffd400" x={0} y={0} width={96} height={96} effects={[Shadow.drop({ y: 3, blur: 6 })]} />
          <Text id="badge-text" name="Badge text" content={`-${p.discount}%`} style={{ position: 'absolute', left: 0, top: 31, width: 96, textAlign: 'center', fontSize: 27, fontWeight: 900, color: '#1a1200' }} />
        </Layer.Group>
      ) : null}
    </div>
  );
}

export const HeaderSchema = z.object({
  title: z.string().default('CHRONO BLADE'),
  callout: z.string().default('OUT NOW'),
  colorA: zColor('#ff3366'),
  colorB: zColor('#2b1055'),
  logoX: z.number().default(30),
  logoY: z.number().default(70),
  logoSize: zSlider(20, 80, 46),
});

function HeaderCapsule(p: z.infer<typeof HeaderSchema>) {
  return (
    <div style={{ width: 460, height: 215, backgroundColor: '#0a0a12' }}>
      <Layer.Gradient id="bg" name="Background" type="linear" angle={120} colors={[p.colorB, '#0a0a12']} />
      <Layer.Gradient id="splash" name="Colour splash" type="radial" cx="78%" cy="40%" radius="70%" colors={[`${p.colorA}aa`, 'rgba(0,0,0,0)']} blendMode="screen" />
      <Layer.Pattern id="scan" name="Scanlines" pattern="scanlines" spacing={3} thickness={1} color="rgba(0,0,0,0.25)" />
      <Layer.Star id="emblem" name="Emblem" x={300} y={30} width={150} height={150} points={8} innerRatio={0.45} fill={p.colorA} opacity={0.85} effects={[Shadow.glow(p.colorA, { radius: 4, blur: 20 })]} />
      <Text
        id="logo"
        name="Logo"
        content={p.title}
        x={p.logoX}
        y={p.logoY}
        bind={{ x: 'logoX', y: 'logoY' }}
        style={{ width: 300, fontFamily: 'Cinzel', fontSize: p.logoSize, fontWeight: 900, lineHeight: 0.95, color: '#fff3d6' }}
        strokes={[{ color: '#5a1a00', width: 2, align: 'outside' } as any, { color: '#000000', width: 3, align: 'outside' } as any]}
        effects={[Shadow.drop({ y: 3, blur: 6 })]}
      />
      <Layer.Rect id="callout-bg" name="Callout" x={30} y={170} width={96} height={26} cornerRadius={13} fill={p.colorA} />
      <Text id="callout" name="Callout text" content={p.callout} x={30} y={175} style={{ width: 96, textAlign: 'center', fontSize: 13, fontWeight: 900, letterSpacing: 1.5, color: '#ffffff' }} />
    </div>
  );
}

export const LibraryHeroSchema = z.object({
  accentColor: zColor('#38bdf8'),
  horizon: zSlider(400, 1100, 820),
});

function LibraryHero(p: z.infer<typeof LibraryHeroSchema>) {
  return (
    <div style={{ width: 3840, height: 1240, backgroundColor: '#05070d' }}>
      <Layer.Gradient id="sky" name="Sky" type="linear" angle={180} colors={['#05070d', '#13213d', p.accentColor]} stops={[0, 0.6, 1]} />
      <Layer.Ellipse id="moon" name="Moon" x={2600} y={160} width={420} height={420} fill="#e8f1ff" effects={[Shadow.glow('#bcd7ff', { radius: 10, blur: 90, opacity: 0.7 })]} />
      <VectorImage id="ridge" name="Ridge" x={0} y={p.horizon - 300} width={3840} height={1540 - p.horizon} markup={MOUNTAINS} fit="fill" bind={{ y: 'horizon' }} />
      <Layer.Gradient id="vignette" name="Vignette" type="radial" colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.7)']} />
    </div>
  );
}

export const studioSamples: CompositionDefinition[] = [
  defineComposition({
    id: 'studio-demo-capsule',
    name: 'Demo Main Capsule',
    description: 'Steam main capsule demo: bound hero position, sale badge, theme presets.',
    width: 616,
    height: 353,
    component: DemoCapsule,
    schema: DemoCapsuleSchema,
    defaultProps: {},
    preset: 'steam-main-capsule',
    platform: 'steam',
    folder: 'Studio Samples',
    tags: ['sample', 'steam'],
  }),
  defineComposition({
    id: 'studio-demo-header',
    name: 'Demo Header Capsule',
    width: 460,
    height: 215,
    component: HeaderCapsule,
    schema: HeaderSchema,
    defaultProps: {},
    preset: 'steam-header-capsule',
    platform: 'steam',
    folder: 'Studio Samples',
    tags: ['sample', 'steam'],
  }),
  defineComposition({
    id: 'studio-demo-library-hero',
    name: 'Demo Library Hero',
    width: 3840,
    height: 1240,
    component: LibraryHero,
    schema: LibraryHeroSchema,
    defaultProps: {},
    preset: 'steam-library-hero',
    platform: 'steam',
    folder: 'Studio Samples',
    tags: ['sample', 'steam'],
    safeZones: [
      { id: 'title-safe', label: 'Title safe area', kind: 'safe', x: 200, y: 100, width: 3440, height: 740 },
      { id: 'client-ui', label: 'Steam client: logo + Play button', kind: 'danger', x: 0, y: 840, width: 1700, height: 400 },
    ],
  }),
];
