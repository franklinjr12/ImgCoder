import { defineComposition, Layer, Text, Shadow, z, type Adjustment, type CompositionDefinition } from '@game-artisan/core';
import { rasterizeSvg } from '@game-artisan/renderer-svg/node';

/** A small "key art" PNG (data URI) used as the hero raster layer. */
export async function heroArtDataUri(): Promise<string> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200" viewBox="0 0 320 200">
    <defs>
      <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1b0f3a"/><stop offset="1" stop-color="#d9480f"/></linearGradient>
      <radialGradient id="sun" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#fff3bf"/><stop offset="1" stop-color="#ff922b"/></radialGradient>
    </defs>
    <rect width="320" height="200" fill="url(#sky)"/>
    <circle cx="210" cy="110" r="52" fill="url(#sun)"/>
    <path d="M0 160 L60 110 L110 150 L170 90 L240 150 L320 120 L320 200 L0 200Z" fill="#2b1a4a"/>
    <path d="M0 185 L80 150 L150 180 L230 140 L320 175 L320 200 L0 200Z" fill="#120a24"/>
    <rect x="40" y="120" width="10" height="30" fill="#ffd43b"/><rect x="58" y="128" width="8" height="22" fill="#ffd43b"/>
  </svg>`;
  const { png } = await rasterizeSvg(svg);
  return `data:image/png;base64,${png.toString('base64')}`;
}

const pixelate: Adjustment = { type: 'pixelate', size: 6 };
const vignette: Adjustment = { type: 'vignette', amount: 0.7, size: 0.45, color: '#000000' };

export const CapsuleSchema = z.object({
  title: z.string().default('STAR FORGE'),
  tagline: z.string().default('Forge your legend'),
  hero: z.string(),
});

/** Realistic Steam-capsule-like vector composition exercising the effects the parity test cares about. */
export function capsuleComposition(hero: string): CompositionDefinition {
  return defineComposition({
    id: 'parity-capsule',
    width: 460,
    height: 215,
    schema: CapsuleSchema,
    defaultProps: { hero },
    component: ({ title, tagline, hero }: z.infer<typeof CapsuleSchema>) => (
      <>
        {/* background gradient */}
        <Layer.Gradient id="bg" x={0} y={0} width={460} height={215} type="linear" angle={135} colors={['#0b1026', '#3b1d6e', '#0e3a5c']} />
        {/* hero raster with vignette + rounded corners */}
        <Layer.Image id="hero" src={hero} x={220} y={10} width={230} height={195} fit="cover" cornerRadius={12} adjustments={[vignette]} />
        {/* radial glow blended with screen */}
        <Layer.Ellipse id="glow" x={240} y={20} width={220} height={160} fill={{ type: 'radial-gradient', cx: 0.5, cy: 0.5, r: 0.5, stops: [{ offset: 0, color: 'rgba(255,190,90,0.9)' }, { offset: 1, color: 'rgba(255,120,40,0)' }] }} blendMode="screen" />
        {/* clipping mask: stripes clipped to a rounded panel */}
        <Layer.Rect id="panel" x={12} y={120} width={200} height={70} cornerRadius={14} fill="#1c2541" />
        <Layer.Pattern id="stripes" x={0} y={110} width={240} height={100} pattern="diagonal" spacing={10} thickness={3} color="rgba(120,200,255,0.55)" clippingMask />
        {/* pixel-art sprite group with pixelate adjustment */}
        <Layer.Group id="sprite" x={150} y={128} width={56} height={56} adjustments={[pixelate]}>
          <Layer.Ellipse id="sprite-body" x={4} y={4} width={48} height={48} fill="#69db7c" />
          <Layer.Ellipse id="sprite-eye" x={16} y={16} width={10} height={14} fill="#ffffff" />
          <Layer.Ellipse id="sprite-eye2" x={32} y={16} width={10} height={14} fill="#ffffff" />
        </Layer.Group>
        {/* outlined title with multi-stroke, drop shadow + glow */}
        <Text
          id="title"
          content={title}
          x={16}
          y={22}
          width={300}
          height={70}
          style={{ fontFamily: 'Cinzel', fontSize: 44, fontWeight: 900, color: '#ffe066' }}
          strokes={[
            { color: '#7a2e00', width: 3, align: 'outside' } as any,
            { color: '#1a0b00', width: 2, align: 'outside' } as any,
          ]}
          effects={[Shadow.drop({ x: 3, y: 4, blur: 6, color: 'rgba(0,0,0,0.75)' }), Shadow.glow('#ffb347', { radius: 2, blur: 10, opacity: 0.7 })]}
        />
        <Text id="tagline" content={tagline} x={20} y={136} width={180} height={30} style={{ fontFamily: 'Inter', fontSize: 16, fontWeight: 700, color: '#e7f5ff' }} blendMode="normal" />
        {/* sale badge star with drop shadow, multiply-blended texture */}
        <Layer.Star id="badge" x={392} y={140} width={60} height={60} points={12} innerRatio={0.8} fill="#e03131" effects={[Shadow.drop({ x: 2, y: 3, blur: 4 })]} />
        <Text id="badge-text" content="-40%" x={392} y={160} width={60} height={22} style={{ fontFamily: 'Inter', fontSize: 15, fontWeight: 900, color: '#ffffff', textAlign: 'center' }} />
        <Layer.Rect id="tint" x={0} y={0} width={460} height={215} fill="rgba(80,40,160,0.25)" blendMode="multiply" />
      </>
    ),
  });
}

/** html composition: CSS blend modes, backdrop-filter, CSS filters and a canvas drawn by `script`. */
export const htmlComposition = defineComposition({
  id: 'html-fx',
  kind: 'html',
  width: 320,
  height: 180,
  schema: z.object({ title: z.string().default('NEON RUN'), accent: z.string().default('#ff2d95') }),
  head: '<style>.title{font-family:Inter;font-weight:900;font-size:40px;color:#fff;letter-spacing:2px}</style>',
  component: ({ title, accent }: { title: string; accent: string }) => (
    <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(135deg,#120458,#000)', overflow: 'hidden' }}>
      <canvas id="fx" width={320} height={180} style={{ position: 'absolute', inset: 0, width: 320, height: 180 }} />
      <div style={{ position: 'absolute', left: 40, top: 30, width: 160, height: 120, borderRadius: 16, background: accent, mixBlendMode: 'screen', filter: 'blur(2px) saturate(1.4)' }} />
      <div style={{ position: 'absolute', left: 120, top: 60, width: 170, height: 90, borderRadius: 12, background: 'rgba(255,255,255,0.15)', backdropFilter: 'blur(8px) brightness(1.3)', border: '1px solid rgba(255,255,255,0.4)' }} />
      <div className="title" style={{ position: 'absolute', left: 20, top: 110, mixBlendMode: 'difference' }}>
        {title}
      </div>
      <img src="assets/dot.svg" width={24} height={24} style={{ position: 'absolute', right: 8, top: 8 }} />
    </div>
  ),
  script: `
    const c = root.querySelector('#fx');
    const g = c.getContext('2d');
    for (let i = 0; i < 40; i++) {
      g.fillStyle = 'hsl(' + (i * 9) + ',100%,60%)';
      g.beginPath(); g.arc(10 + i * 8, 150 - Math.sin(i / 3) * 40, 6, 0, Math.PI * 2); g.fill();
    }
    window.__ARTISAN_READY__ = new Promise((r) => setTimeout(() => { root.dataset.ready = props.title; r(); }, 30));
  `,
});
