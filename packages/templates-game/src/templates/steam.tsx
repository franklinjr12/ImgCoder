/**
 * Steam-specific templates: Library Hero (no text, respects the client safe zones), Library Logo
 * (transparent), Store Page Background (sides fade to #000000) and Community Icon.
 */
import { Layer, Text, getRenderContext } from '@game-artisan/core';
import { z } from 'zod';
import { resolveArt } from '../art.js';
import { LocalizedTitle } from '../components/LocalizedTitle.js';
import { ArtStage, SafeZoneGuides } from '../components/stage.js';
import { artShape, brandingShape, colorProp, gradingProp, imageProp } from '../schemas.js';
import { BUILTIN_ART } from '../art.js';
import { gradingAdjustments, stroke, withAlpha, withCjkFallback } from '../utils.js';
import { currentSafeZones, titleFill } from './KeyArtCapsule.js';

const CHARACTER_ASPECT = 0.6;

// -----------------------------------------------------------------------------------------
// Library hero

export const LibraryHeroSchema = z.object({
  ...artShape,
  characterPosition: z.number().min(0.45, 'Keep the character right of the logo safe zone (≥ 0.45)').max(0.9).default(0.64).describe('Horizontal centre of the character (fraction of width); the bottom-left is covered by the Steam logo'),
  backgroundFocusX: z.number().min(0).max(1).default(0.55),
  backgroundFocusY: z.number().min(0).max(1).default(0.5),
  accentLight: z.boolean().default(true).describe('Soft light bloom behind the character'),
  accentColor: colorProp('#ffb36b'),
  showSafeZones: z.boolean().default(false),
});
export type LibraryHeroProps = z.infer<typeof LibraryHeroSchema>;

/** Steam Library Hero: art only (no text/logo — Steam overlays the Library Logo). */
export function LibraryHero(p: LibraryHeroProps) {
  const { width: W0, height: H0 } = getRenderContext();
  const W = W0 || 3840;
  const H = H0 || 1240;
  const ch = H * 0.98 * p.characterScale;
  const cw = ch * CHARACTER_ASPECT;
  const cx = W * (p.characterPosition + p.characterOffsetX);
  return (
    <div style={{ width: W, height: H, backgroundColor: '#05040c', overflow: 'hidden' }}>
      <ArtStage
        width={W}
        height={H}
        backgroundUrl={p.backgroundUrl}
        backgroundFocus={{ x: p.backgroundFocusX, y: p.backgroundFocusY }}
        characterUrl={p.characterUrl}
        characterBox={{ x: cx - cw / 2, y: H - ch + H * 0.06, width: cw, height: ch }}
        grading={p.grading}
        glow={p.characterGlow}
        glowColor={p.glowColor}
        glowIntensity={p.glowIntensity}
        rimLight={p.rimLight}
        midground={
          p.accentLight ? (
            <Layer.Gradient name="Accent light" type="radial" cx={cx / W} cy={0.55} radius={0.42} colors={[withAlpha(p.accentColor, 0.45), withAlpha(p.accentColor, 0)]} blendMode="screen" />
          ) : null
        }
      />
      {p.showSafeZones ? <SafeZoneGuides zones={currentSafeZones(W, H)} /> : null}
    </div>
  );
}

// -----------------------------------------------------------------------------------------
// Library logo

export const LibraryLogoSchema = z.object({
  title: brandingShape.title,
  logoUrl: brandingShape.logoUrl,
  localeMap: brandingShape.localeMap,
  kicker: z.string().max(48).default('').describe('Optional small line above the logo (empty = none)'),
  titleFont: brandingShape.titleFont,
  bodyFont: brandingShape.bodyFont,
  titleColor: brandingShape.titleColor,
  titleStyle: brandingShape.titleStyle,
  accentColor: brandingShape.accentColor,
  anchor: z.enum(['bottom-left', 'upper-center', 'center', 'bottom-center']).default('bottom-left').describe('Steam library logo placement (matches the Steamworks logo position setting)'),
  emblemUrl: imageProp(BUILTIN_ART.logo, 'Emblem shown beside the title'),
  showEmblem: z.boolean().default(true),
  outlineColor: colorProp('#0a0614', 'Outline colour (keeps the logo readable over any hero art)'),
  showSafeZones: z.boolean().default(false),
});
export type LibraryLogoProps = z.infer<typeof LibraryLogoSchema>;

/** Steam Library Logo: transparent background, logo anchored where Steam will place it. */
export function LibraryLogo(p: LibraryLogoProps) {
  const { width: W0, height: H0 } = getRenderContext();
  const W = W0 || 1280;
  const H = H0 || 720;
  const pad = Math.round(H * 0.06);
  const centered = p.anchor !== 'bottom-left';
  const emblemS = p.showEmblem && p.emblemUrl ? Math.round(H * 0.34) : 0;
  const blockW = W - pad * 2;
  const blockH = H * 0.62;
  const blockY = p.anchor === 'upper-center' ? pad : p.anchor === 'center' ? (H - blockH) / 2 : H - pad - blockH;
  const titleX = pad + (centered ? 0 : emblemS ? emblemS + pad * 0.6 : 0);
  const titleW = blockW - (centered ? 0 : emblemS ? emblemS + pad * 0.6 : 0);
  const kickerH = p.kicker ? H * 0.07 : 0;
  const titleY = blockY + (centered && emblemS ? emblemS * 0.9 : 0) + kickerH;
  const titleH = blockH - (centered && emblemS ? emblemS * 0.9 : 0) - kickerH;
  const emblem = resolveArt(p.emblemUrl);
  const fx = [{ type: 'drop-shadow' as const, x: 0, y: H * 0.008, blur: H * 0.02, spread: 0, color: 'rgba(0,0,0,0.75)', opacity: 1 }];
  return (
    <div style={{ width: W, height: H }}>
      {emblemS && emblem ? (
        <Layer.Image
          id="emblem"
          name="Emblem"
          src={emblem}
          fit="contain"
          x={centered ? (W - emblemS) / 2 : pad}
          y={centered ? blockY : blockY + blockH - emblemS - titleH * 0.08}
          width={emblemS}
          height={emblemS}
          effects={fx}
        />
      ) : null}
      {p.kicker ? (
        <Text
          id="kicker"
          name="Kicker"
          content={p.kicker}
          fit="shrink"
          maxLines={1}
          strokes={[stroke(p.outlineColor, H * 0.005)]}
          style={{ position: 'absolute', left: titleX, top: titleY - kickerH, width: titleW, height: kickerH, fontFamily: withCjkFallback(p.bodyFont), fontSize: kickerH * 0.7, fontWeight: 900, letterSpacing: kickerH * 0.15, textTransform: 'uppercase', color: p.accentColor, textAlign: centered ? 'center' : 'left', verticalAlign: 'middle' }}
        />
      ) : null}
      <LocalizedTitle
        localeMap={p.localeMap}
        text={p.title}
        logo={p.logoUrl || undefined}
        x={titleX}
        y={titleY}
        width={titleW}
        height={titleH}
        fontFamily={p.titleFont}
        color={p.titleColor}
        fill={titleFill(p.titleStyle, p.titleColor, p.accentColor)}
        textAlign={centered ? 'center' : 'left'}
        verticalAlign={p.anchor === 'upper-center' ? 'top' : p.anchor === 'center' ? 'middle' : 'bottom'}
        letterSpacing={H * 0.004}
        strokes={[stroke(p.outlineColor, Math.max(1, H * 0.009))]}
        effects={fx}
      />
      {p.showSafeZones ? <SafeZoneGuides zones={currentSafeZones(W, H)} /> : null}
    </div>
  );
}

// -----------------------------------------------------------------------------------------
// Store page background

export const PageBackgroundSchema = z.object({
  backgroundUrl: artShape.backgroundUrl,
  characterUrl: imageProp('', 'Optional character cutout placed in a side gutter'),
  characterSide: z.enum(['left', 'right']).default('right'),
  backgroundFocusX: z.number().min(0).max(1).default(0.5),
  backgroundFocusY: z.number().min(0).max(1).default(0.35),
  dim: z.number().min(0).max(100).default(35).describe('Darken the art so store text stays readable (0-100)'),
  fadeWidth: z.number().min(0.05).max(0.45).default(0.2).describe('Width of the side fade to #000000 (fraction of width)'),
  bottomFade: z.number().min(0).max(0.8).default(0.35).describe('Height of the bottom fade to black (fraction of height)'),
  tintColor: colorProp('#2a1550', 'Colour wash over the art'),
  tintAmount: z.number().min(0).max(1).default(0.25),
  grading: gradingProp(),
  blur: z.number().min(0).max(20).default(0).describe('Background blur radius (px)'),
  showSafeZones: z.boolean().default(false),
});
export type PageBackgroundProps = z.infer<typeof PageBackgroundSchema>;

/** Steam store page background: low-contrast art whose sides fade softly to #000000. */
export function PageBackground(p: PageBackgroundProps) {
  const { width: W0, height: H0 } = getRenderContext();
  const W = W0 || 1438;
  const H = H0 || 810;
  const bg = resolveArt(p.backgroundUrl);
  const ch = resolveArt(p.characterUrl);
  const fade = p.fadeWidth;
  const dim = p.dim / 100;
  const chH = H * 0.86;
  const chW = chH * CHARACTER_ASPECT;
  const gutter = (W - 940) / 2;
  const chX = p.characterSide === 'right' ? W - gutter - chW * 0.35 : gutter - chW * 0.65;
  const adjustments = [...gradingAdjustments(p.grading, Math.min(W, H)), ...(p.blur > 0 ? [{ type: 'blur' as const, radius: p.blur }] : [])];
  return (
    <div style={{ width: W, height: H, backgroundColor: '#000000', overflow: 'hidden' }}>
      <Layer.Group id="art" name="Art" adjustments={adjustments} style={{ position: 'absolute', left: 0, top: 0, width: W, height: H }}>
        {bg ? <Layer.Image id="background" name="Background" src={bg} fit="cover" position={{ x: p.backgroundFocusX, y: p.backgroundFocusY }} x={0} y={0} width={W} height={H} /> : null}
        {ch ? <Layer.Image id="character" name="Character" src={ch} fit="contain" position={{ x: 0.5, y: 1 }} x={chX} y={H - chH} width={chW} height={chH} opacity={0.9} /> : null}
      </Layer.Group>
      <Layer.Rect id="tint" name="Tint" fill={p.tintColor} opacity={p.tintAmount} blendMode="color" x={0} y={0} width={W} height={H} />
      <Layer.Rect id="dim" name="Dim" fill="#000000" opacity={dim} x={0} y={0} width={W} height={H} />
      <Layer.Gradient id="fade-left" name="Fade left" type="linear" angle={90} colors={['#000000', 'rgba(0,0,0,0.85)', 'rgba(0,0,0,0)']} stops={[0, 0.35, 1]} x={0} y={0} width={W * fade} height={H} />
      <Layer.Gradient id="fade-right" name="Fade right" type="linear" angle={270} colors={['#000000', 'rgba(0,0,0,0.85)', 'rgba(0,0,0,0)']} stops={[0, 0.35, 1]} x={W - W * fade} y={0} width={W * fade} height={H} />
      {p.bottomFade > 0 ? <Layer.Gradient id="fade-bottom" name="Fade bottom" type="linear" angle={0} colors={['#000000', 'rgba(0,0,0,0)']} x={0} y={H * (1 - p.bottomFade)} width={W} height={H * p.bottomFade} /> : null}
      {p.showSafeZones ? <SafeZoneGuides zones={currentSafeZones(W, H)} /> : null}
    </div>
  );
}

// -----------------------------------------------------------------------------------------
// Community icon

export const CommunityIconSchema = z.object({
  iconUrl: imageProp(BUILTIN_ART.logo, 'Icon / logo mark'),
  monogram: z.string().max(3, 'Monograms are 1–3 characters').default('').describe('Render these letters instead of the icon image (e.g. "SR")'),
  background: z.enum(['radial', 'solid', 'none']).default('radial'),
  backgroundColor: colorProp('#1b1f4a'),
  accentColor: colorProp('#ffb36b'),
  padding: z.number().min(0).max(0.4).default(0.1).describe('Inner padding (fraction of the icon size)'),
  cornerRadius: z.number().min(0).max(0.5).default(0).describe('Rounded corners (fraction of size); Steam crops nothing, so 0 is typical'),
  monogramFont: z.string().default('Cinzel'),
});
export type CommunityIconProps = z.infer<typeof CommunityIconSchema>;

/** Steam community / app icon (32×32 and 184×184): a bold mark, no small text. */
export function CommunityIcon(p: CommunityIconProps) {
  const { width: W0, height: H0 } = getRenderContext();
  const S = Math.min(W0 || 184, H0 || 184);
  const pad = Math.round(S * p.padding);
  const icon = resolveArt(p.iconUrl);
  const fill =
    p.background === 'radial'
      ? `radial-gradient(circle at 50% 40%, ${p.accentColor} 0%, ${p.backgroundColor} 70%)`
      : p.background === 'solid'
        ? p.backgroundColor
        : undefined;
  return (
    <div style={{ width: S, height: S }}>
      {fill ? <Layer.Rect id="icon-bg" name="Icon background" fill={fill} cornerRadius={S * p.cornerRadius} x={0} y={0} width={S} height={S} /> : null}
      {p.monogram ? (
        <Text
          id="monogram"
          name="Monogram"
          content={p.monogram}
          fit="shrink"
          maxLines={1}
          strokes={[stroke('#0a0614', Math.max(0.5, S * 0.02))]}
          style={{ position: 'absolute', left: pad, top: pad, width: S - pad * 2, height: S - pad * 2, fontFamily: withCjkFallback(p.monogramFont), fontSize: S * 0.6, fontWeight: 900, color: '#ffffff', textAlign: 'center', verticalAlign: 'middle' }}
        />
      ) : icon ? (
        <Layer.Image id="icon" name="Icon" src={icon} fit="contain" x={pad} y={pad} width={S - pad * 2} height={S - pad * 2} effects={S >= 64 ? [{ type: 'drop-shadow', x: 0, y: S * 0.015, blur: S * 0.03, spread: 0, color: 'rgba(0,0,0,0.6)', opacity: 1 }] : []} />
      ) : null}
    </div>
  );
}
