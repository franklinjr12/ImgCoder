/**
 * Cinder Orbit: Survivors — multi-language store bundle.
 *
 * Shows: `localeMap` logo swapping (US-5.4) with a localized SVG logo per CJK locale, CJK font
 * fallback for localized taglines, a batch data file (languages.json) rendering every
 * composition × locale, and reuse of the templates-game components (LocalizedTitle,
 * WishlistCallout, DemoAvailableBadge, ArtStage, KeyArtCapsule).
 */
import { Composition, Folder, Layer, Text, getRenderContext, registerRoot, z, zSlider } from '@game-artisan/core';
import {
  ArtStage,
  DemoAvailableBadge,
  KeyArtCapsule,
  KeyArtCapsuleSchema,
  LocalizedTitle,
  Scrim,
  TitleLocaleMapSchema,
  WishlistCallout,
  aspectClass,
  colorProp,
  gradingProp,
  imageProp,
  presetCompositionProps,
  stroke,
  withAlpha,
  withCjkFallback,
} from '@game-artisan/templates-game';

/** Localized logos: en is the default `logoUrl`; CJK locales swap to their own vector logo. */
export const LOGO_LOCALE_MAP = {
  ja: { logo: 'assets/logos/logo-ja.svg' },
  ko: { logo: 'assets/logos/logo-ko.svg' },
  'zh-CN': { logo: 'assets/logos/logo-zh-CN.svg' },
};

export const SciFiCapsuleSchema = z.object({
  title: z.string().min(1).default('Cinder Orbit: Survivors').describe('Text fallback when no logo applies'),
  logoUrl: imageProp('assets/logos/logo-en.svg', 'Default (English) logo'),
  localeMap: TitleLocaleMapSchema.default(LOGO_LOCALE_MAP),
  tagline: z.string().max(90).default('Hold the line. Ten thousand drones. One orbit.'),
  statusText: z.string().max(24).default('Early Access').describe('HUD status chip (empty = none)'),
  ctaText: z.string().max(28).default('Wishlist now'),
  showDemo: z.boolean().default(false).describe('Show a "Demo available" badge next to the CTA'),
  demoText: z.string().max(28).default('Free demo'),
  backgroundUrl: imageProp('assets/backgrounds/derelict-orbit.svg', 'Background'),
  characterUrl: imageProp('assets/characters/pilot.svg', 'Character cutout'),
  accentColor: colorProp('#2fd3ff'),
  secondaryColor: colorProp('#ff6ad5'),
  grading: gradingProp().default('vibrant-arcade'),
  glowIntensity: zSlider(0, 100, 55),
  hud: z.boolean().default(true).describe('Corner brackets, scanlines and status chip'),
});

export type SciFiCapsuleProps = z.infer<typeof SciFiCapsuleSchema>;

/** HUD-styled capsule that adapts to wide / tall / tiny canvases. */
export function SciFiCapsule(p: SciFiCapsuleProps) {
  const { width: W, height: H } = getRenderContext();
  const cls = aspectClass(W, H);
  const wide = cls === 'wide' || cls === 'tiny';
  const u = Math.min(W, H) / 100;
  const m = Math.round(u * 6);
  const chH = wide ? H * 1.02 : H * 0.7;
  const chW = chH * 0.6;
  const chX = wide ? W * 0.74 - chW / 2 : W * 0.5 - chW / 2;
  const chY = wide ? H - chH + H * 0.06 : H * 0.05;
  const ctaH = Math.round(u * (wide ? 11 : 9));
  const ctaY = wide ? H - m * 1.2 - ctaH : H - m - ctaH;
  const taglineH = u * (wide ? 11 : 10);
  const ctaW = Math.max(ctaH * 4.2, wide ? W * 0.3 : 0);
  // tall: stack bottom-up (CTA → tagline → logo) so nothing overlaps
  const logoBox = wide
    ? { x: m * 1.2, y: m * 1.6, width: W * 0.58, height: H * 0.48 }
    : { x: m, y: ctaY - u * 2 - taglineH - u * 1.5 - H * 0.2, width: W - m * 2, height: H * 0.2 };
  const bracket = u * 7;
  const body = withCjkFallback('Inter');
  const corners: [number, number, number][] = [
    [m * 0.6, m * 0.6, 0],
    [W - m * 0.6 - bracket, m * 0.6, 90],
    [W - m * 0.6 - bracket, H - m * 0.6 - bracket, 180],
    [m * 0.6, H - m * 0.6 - bracket, 270],
  ];
  return (
    <div style={{ width: W, height: H, backgroundColor: '#04051a', overflow: 'hidden' }}>
      <ArtStage
        width={W}
        height={H}
        backgroundUrl={p.backgroundUrl}
        backgroundFocus={{ x: 0.62, y: 0.5 }}
        characterUrl={p.characterUrl}
        characterBox={{ x: chX, y: chY, width: chW, height: chH }}
        grading={p.grading}
        glow
        glowColor={p.accentColor}
        glowIntensity={p.glowIntensity}
        rimLight
        rimColor={p.secondaryColor}
      />
      <Scrim id="scrim" angle={wide ? 90 : 0} extent={wide ? 0.72 : 0.55} strength={0.82} color="#04051a" />
      <LocalizedTitle
        localeMap={p.localeMap}
        text={p.title}
        logo={p.logoUrl || undefined}
        x={logoBox.x}
        y={logoBox.y}
        width={logoBox.width}
        height={logoBox.height}
        textAlign={wide ? 'left' : 'center'}
        verticalAlign={wide ? 'middle' : 'bottom'}
        fontFamily="Bebas Neue"
        fontWeight={400}
        fill={`linear-gradient(180deg, #ffffff 0%, ${p.accentColor} 100%)`}
        strokes={[stroke('#050a24', Math.max(1, u * 0.8))]}
        effects={[{ type: 'outer-glow', color: p.accentColor, radius: 0, blur: u * 2, opacity: 0.45, blendMode: 'normal' }]}
      />
      {p.tagline && cls !== 'tiny' ? (
        <Text
          id="tagline"
          name="Tagline"
          content={p.tagline}
          fit="shrink"
          maxLines={2}
          style={{
            position: 'absolute',
            left: logoBox.x,
            top: logoBox.y + logoBox.height + u * 1.5,
            width: logoBox.width,
            height: taglineH,
            fontFamily: body,
            fontSize: u * 4.4,
            fontWeight: 700,
            lineHeight: 1.25,
            color: '#e6f4ff',
            textAlign: wide ? 'left' : 'center',
            textShadow: `0 1px ${u}px rgba(0,0,0,0.9)`,
          }}
        />
      ) : null}
      {cls !== 'tiny' ? (
        <WishlistCallout x={wide ? m * 1.2 : (W - ctaW - (p.showDemo ? ctaW + u * 2 : 0)) / 2} y={ctaY} width={ctaW} height={ctaH} text={p.ctaText} variant="solid" color={p.secondaryColor} textColor="#12051f" icon="plus" />
      ) : null}
      {p.showDemo && cls !== 'tiny' ? (
        <DemoAvailableBadge x={(wide ? m * 1.2 : (W - ctaW * 2 - u * 2) / 2) + ctaW + u * 2} y={ctaY} width={ctaW} height={ctaH} text={p.demoText} subtext="" variant="outline" color={p.accentColor} />
      ) : null}
      {p.hud ? (
        <Layer.Group id="hud" name="HUD" x={0} y={0} width={W} height={H}>
          <Layer.Pattern name="Scanlines" pattern="scanlines" spacing={Math.max(2, Math.round(u * 0.8))} thickness={1} color="rgba(127,246,255,0.05)" />
          {corners.map(([x, y, r], i) => (
            <Layer.Path key={i} name={`Bracket ${i + 1}`} d={`M0 ${bracket}V0H${bracket}`} fill={{ type: 'none' }} strokes={[stroke(p.accentColor, Math.max(1, u * 0.5), 'center')]} x={x} y={y} width={bracket} height={bracket} rotation={r} />
          ))}
          {p.statusText ? (
            <Layer.Group name="Status chip" style={{ position: 'absolute', right: m * 1.2, top: m * 1.2, height: u * 6, paddingHorizontal: u * 2, flexDirection: 'row', alignItems: 'center', gap: u * 1.2, backgroundColor: withAlpha('#04051a', 0.7), borderRadius: u, border: `${Math.max(1, u * 0.3)}px solid ${p.accentColor}` }}>
              <Layer.Ellipse name="Status dot" fill={p.secondaryColor} style={{ width: u * 1.6, height: u * 1.6 }} />
              <Text name="Status" content={p.statusText} style={{ fontFamily: body, fontSize: u * 2.8, fontWeight: 900, letterSpacing: u * 0.4, textTransform: 'uppercase', color: '#e6f4ff', whiteSpace: 'nowrap' }} />
            </Layer.Group>
          ) : null}
        </Layer.Group>
      ) : null}
    </div>
  );
}

const sci = (presetKey: string, id: string, tags: string[], defaultProps: Partial<z.input<typeof SciFiCapsuleSchema>> = {}) => {
  const base = presetCompositionProps(presetKey);
  return <Composition key={id} {...base} id={id} component={SciFiCapsule} schema={SciFiCapsuleSchema} defaultProps={defaultProps} tags={['sci-fi', 'localized', ...tags]} />;
};

registerRoot(() => (
  <>
    <Folder name="Steam">
      {sci('STEAM_HEADER_CAPSULE', 'steam-header', ['steam', 'capsule'], { statusText: '' })}
      {sci('STEAM_MAIN_CAPSULE', 'steam-main', ['steam', 'capsule'], { showDemo: true })}
      {sci('STEAM_VERTICAL_CAPSULE', 'steam-vertical', ['steam', 'capsule'])}
      {/* The built-in adaptive template, re-skinned with this project's art + localized logos. */}
      <Composition
        {...presetCompositionProps('STEAM_LIBRARY_CAPSULE')}
        id="steam-library-capsule"
        component={KeyArtCapsule}
        schema={KeyArtCapsuleSchema}
        defaultProps={{
          title: 'Cinder Orbit: Survivors',
          logoUrl: 'assets/logos/logo-en.svg',
          localeMap: LOGO_LOCALE_MAP,
          kicker: '',
          tagline: 'Hold the line. Ten thousand drones. One orbit.',
          backgroundUrl: 'assets/backgrounds/derelict-orbit.svg',
          characterUrl: 'assets/characters/pilot.svg',
          backgroundFocusX: 0.7,
          accentColor: '#2fd3ff',
          glowColor: '#2fd3ff',
          grading: 'vibrant-arcade',
          rimLight: true,
        }}
        tags={['sci-fi', 'localized', 'steam', 'library']}
      />
    </Folder>
    <Folder name="Social">{sci('SOCIAL_TWITTER_CARD', 'twitter-card', ['social', 'twitter'], { showDemo: true })}</Folder>
  </>
));
