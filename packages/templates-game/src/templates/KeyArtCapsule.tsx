import { Layer, Text, getRenderContext, type SafeZone } from '@game-artisan/core';
import { z } from 'zod';
import { Laurel } from '../components/Laurel.js';
import { resolveTitle } from '../components/LocalizedTitle.js';
import { DemoAvailableBadge, SaleBadge, WishlistCallout, saleBadgeHeight } from '../components/badges.js';
import { ArtStage, SafeZoneGuides, Scrim, TitleLockup, type Box } from '../components/stage.js';
import { STORE_PRESETS, presetForSize, presetSafeZones } from '../presets.js';
import { artShape, badgeShape, brandingShape, layoutProp } from '../schemas.js';
import { aspectClass, clamp, mixColors, withCjkFallback, type AspectClass } from '../utils.js';

export const KeyArtCapsuleSchema = z.object({
  ...brandingShape,
  ...artShape,
  ...badgeShape,
  layout: layoutProp(),
  backgroundFocusX: z.number().min(0).max(1).default(0.55).describe('Background focal point X (0 = left, 1 = right)'),
  backgroundFocusY: z.number().min(0).max(1).default(0.5).describe('Background focal point Y'),
  scrimStrength: z.number().min(0).max(1).default(0.8).describe('Darkening behind the title for legibility'),
});

export type KeyArtCapsuleProps = z.infer<typeof KeyArtCapsuleSchema>;

/** The art's character cutout aspect (builtin hero is 600×1000). */
const CHARACTER_ASPECT = 0.6;

/** Title fill for the chosen style. */
export function titleFill(style: KeyArtCapsuleProps['titleStyle'], titleColor: string, accent: string): string | undefined {
  if (style !== 'gradient') return undefined;
  return `linear-gradient(180deg, ${titleColor} 0%, ${mixColors(titleColor, accent, 0.25)} 55%, ${mixColors(titleColor, accent, 0.75)} 100%)`;
}

/** Safe zones to draw for the composition currently being rendered (preset id or `<preset>-variant`). */
export function currentSafeZones(W: number, H: number): SafeZone[] {
  const id = getRenderContext().compositionId ?? '';
  const byId = Object.values(STORE_PRESETS)
    .filter((s) => id === s.id || id.startsWith(`${s.id}-`))
    .sort((a, b) => b.id.length - a.id.length)[0];
  const spec = byId ?? presetForSize(W, H);
  return spec && spec.width === W && spec.height === H ? presetSafeZones(spec) : [];
}

interface CapsuleLayout {
  cls: AspectClass;
  margin: number;
  character?: Box;
  lockup: Box;
  titleHeight: number;
  align: 'left' | 'center';
  anchor: 'top' | 'center' | 'bottom';
  scrims: { angle: number; extent: number; strength: number }[];
  showKicker: boolean;
  showTagline: boolean;
  sale?: { x: number; y: number; size: number };
  laurel?: { x: number; y: number; width: number };
  callout?: Box;
  banner?: Box;
}

function layoutFor(W: number, H: number, cls: AspectClass, p: KeyArtCapsuleProps, hasLaurel: boolean): CapsuleLayout {
  const m = Math.round(Math.min(W, H) * (cls === 'tiny' ? 0.08 : 0.07));
  const scale = p.characterScale;
  const banner = p.eventBanner && cls !== 'tiny' ? { x: 0, y: 0, width: W, height: Math.round(clamp(H * (cls === 'tall' ? 0.075 : 0.1), 14, 120)) } : undefined;
  const top = banner ? banner.height : 0;
  const hasCallout = p.callout !== 'none' && cls !== 'tiny';
  const r = W / H;
  switch (cls) {
    case 'tiny': {
      const ch = H * 1.22 * scale;
      return {
        cls,
        margin: m,
        character: { x: W - ch * CHARACTER_ASPECT * 0.92 + p.characterOffsetX * W, y: H - ch + H * 0.12, width: ch * CHARACTER_ASPECT, height: ch },
        lockup: { x: m * 1.2, y: m * 0.6, width: W * 0.7, height: H - m * 1.2 },
        titleHeight: H - m * 1.2,
        align: 'left',
        anchor: 'center',
        scrims: [{ angle: 90, extent: 0.85, strength: Math.min(1, p.scrimStrength + 0.1) }],
        showKicker: false,
        showTagline: false,
        sale: p.discount > 0 ? { x: W - H * 0.62, y: H * 0.06, size: H * 0.58 } : undefined,
      };
    }
    case 'wide': {
      const veryWide = r > 2.6;
      const ch = H * (veryWide ? 1.12 : 1.04) * scale;
      const cw = ch * CHARACTER_ASPECT;
      const cx = W * (veryWide ? 0.74 : 0.71) + p.characterOffsetX * W;
      const lockW = W * (veryWide ? 0.5 : 0.56) - m;
      const calloutH = hasCallout ? Math.round(H * 0.13) : 0;
      const lockup = { x: m * 1.3, y: top + m, width: lockW, height: H - top - m * 2 - (calloutH ? calloutH + m * 0.6 : 0) };
      const titleHeight = Math.min(lockup.height * (p.tagline ? 0.5 : 0.6), lockW * 0.42);
      const saleSize = Math.round(H * 0.34);
      return {
        cls,
        margin: m,
        character: { x: cx - cw / 2, y: H - ch + H * 0.05, width: cw, height: ch },
        lockup,
        titleHeight,
        align: 'left',
        anchor: 'center',
        scrims: [
          { angle: 90, extent: 0.68, strength: p.scrimStrength },
          { angle: 0, extent: 0.35, strength: p.scrimStrength * 0.6 },
        ],
        showKicker: true,
        showTagline: true,
        sale: p.discount > 0 ? { x: W - saleSize - m * 0.6, y: H - saleSize - m * 0.6, size: saleSize } : undefined,
        laurel: hasLaurel ? { x: W - W * 0.22 - m * 0.6, y: top + m * 0.6, width: W * 0.22 } : undefined,
        callout: hasCallout ? { x: m * 1.3, y: H - m - calloutH, width: Math.min(lockW, calloutH * 4.4), height: calloutH } : undefined,
        banner,
      };
    }
    case 'tall': {
      const ch = H * 0.8 * scale;
      const cw = ch * CHARACTER_ASPECT;
      const cx = W * 0.5 + p.characterOffsetX * W;
      const calloutH = hasCallout ? Math.round(W * 0.13) : 0;
      const lockTop = H * 0.55;
      const lockup = { x: m, y: lockTop, width: W - m * 2, height: H - lockTop - m - (calloutH ? calloutH + m * 0.5 : 0) };
      const saleSize = Math.round(W * 0.3);
      const laurelW = W * 0.36;
      return {
        cls,
        margin: m,
        character: { x: cx - cw / 2, y: top + H * 0.04, width: cw, height: ch },
        lockup,
        titleHeight: Math.min(lockup.height * 0.5, W * 0.34),
        align: 'center',
        anchor: 'bottom',
        scrims: [{ angle: 0, extent: 0.58, strength: p.scrimStrength }],
        showKicker: true,
        showTagline: true,
        sale: p.discount > 0 ? { x: W - saleSize - m * 0.5, y: top + m * 0.5, size: saleSize } : undefined,
        laurel: hasLaurel ? { x: m * 0.6, y: top + m * 0.6, width: laurelW } : undefined,
        callout: hasCallout ? { x: (W - Math.min(W - m * 2, calloutH * 4.4)) / 2, y: H - m - calloutH, width: Math.min(W - m * 2, calloutH * 4.4), height: calloutH } : undefined,
        banner,
      };
    }
    default: {
      const ch = H * 0.96 * scale;
      const cw = ch * CHARACTER_ASPECT;
      const cx = W * 0.68 + p.characterOffsetX * W;
      const calloutH = hasCallout ? Math.round(H * 0.11) : 0;
      const lockTop = H * 0.4;
      const lockW = W * 0.62;
      const lockup = { x: m * 1.2, y: lockTop, width: lockW, height: H - lockTop - m - (calloutH ? calloutH + m * 0.5 : 0) };
      const saleSize = Math.round(Math.min(W, H) * 0.28);
      return {
        cls,
        margin: m,
        character: { x: cx - cw / 2, y: H - ch + H * 0.04, width: cw, height: ch },
        lockup,
        titleHeight: Math.min(lockup.height * 0.55, lockW * 0.4),
        align: 'left',
        anchor: 'bottom',
        scrims: [
          { angle: 0, extent: 0.62, strength: p.scrimStrength },
          { angle: 90, extent: 0.7, strength: p.scrimStrength * 0.55 },
        ],
        showKicker: true,
        showTagline: true,
        sale: p.discount > 0 ? { x: W - saleSize - m * 0.5, y: top + m * 0.5, size: saleSize } : undefined,
        laurel: hasLaurel ? { x: m * 0.8, y: top + m * 0.8, width: W * 0.3 } : undefined,
        callout: hasCallout ? { x: m * 1.2, y: H - m - calloutH, width: Math.min(lockW, calloutH * 4.4), height: calloutH } : undefined,
        banner,
      };
    }
  }
}

/**
 * Adaptive key-art capsule: one template for every store capsule. It reflows for wide
 * (header/main/banner), tall (vertical/library/portrait), square (covers/icons) and tiny
 * (small capsule) canvases while keeping the title legible.
 */
export function KeyArtCapsule(p: KeyArtCapsuleProps) {
  const ctx = getRenderContext();
  const W = ctx.width || 616;
  const H = ctx.height || 353;
  const cls: AspectClass = p.layout === 'auto' ? aspectClass(W, H) : p.layout;
  const hasLaurel = !!(p.laurelText || p.laurelTitle);
  const L = layoutFor(W, H, cls, p, hasLaurel);
  const t = resolveTitle(p.localeMap, { text: p.title, logo: p.logoUrl || undefined, tagline: p.tagline || undefined, kicker: p.kicker || undefined });
  const tiny = cls === 'tiny';
  const strokeColor = p.titleStyle === 'outline' || tiny ? '#0a0614' : undefined;
  const calloutText = p.calloutText || undefined;
  return (
    <div style={{ width: W, height: H, backgroundColor: '#07060f', overflow: 'hidden' }}>
      <ArtStage
        width={W}
        height={H}
        backgroundUrl={p.backgroundUrl}
        backgroundFocus={{ x: p.backgroundFocusX, y: p.backgroundFocusY }}
        characterUrl={p.characterUrl}
        characterBox={L.character}
        grading={p.grading}
        glow={p.characterGlow}
        glowColor={p.glowColor}
        glowIntensity={p.glowIntensity}
        rimLight={p.rimLight}
      />
      {L.scrims.map((s, i) => (
        <Scrim key={i} id={`scrim-${i}`} angle={s.angle} extent={s.extent} strength={s.strength} />
      ))}
      <TitleLockup
        box={L.lockup}
        align={L.align}
        anchor={L.anchor}
        kicker={L.showKicker ? t.kicker : undefined}
        title={p.title}
        logo={p.logoUrl || undefined}
        localeMap={p.localeMap}
        tagline={L.showTagline ? t.tagline : undefined}
        titleHeight={L.titleHeight}
        titleFont={p.titleFont}
        bodyFont={p.bodyFont}
        titleColor={p.titleColor}
        titleFill={titleFill(p.titleStyle, p.titleColor, p.accentColor)}
        titleStrokeColor={strokeColor}
        accentColor={p.accentColor}
        titleMaxLines={tiny ? 2 : 3}
      />
      {L.banner ? (
        <Layer.Group id="event-banner" name="Event banner" style={{ position: 'absolute', left: L.banner.x, top: L.banner.y, width: L.banner.width, height: L.banner.height, backgroundColor: p.accentColor }}>
          <Text
            name="Event banner text"
            content={p.eventBanner}
            fit="shrink"
            maxLines={1}
            style={{ position: 'absolute', left: L.margin, top: 0, width: L.banner.width - L.margin * 2, height: L.banner.height, fontFamily: withCjkFallback(p.bodyFont), fontSize: L.banner.height * 0.5, fontWeight: 900, letterSpacing: L.banner.height * 0.06, textTransform: 'uppercase', color: '#140a05', textAlign: 'center', verticalAlign: 'middle' }}
          />
        </Layer.Group>
      ) : null}
      {L.laurel ? <Laurel x={L.laurel.x} y={L.laurel.y} width={L.laurel.width} text={p.laurelText} title={p.laurelTitle} year={p.laurelYear} leafStyle={p.laurelStyle} color="#f5d27a" effects={[{ type: 'drop-shadow', x: 0, y: 1, blur: L.laurel.width * 0.03, spread: 0, color: 'rgba(0,0,0,0.8)', opacity: 1 }]} /> : null}
      {L.sale
        ? (() => {
            // Round badges use the slot size; flat shapes (tag/ribbon/pill) are wider and shorter.
            const round = p.saleShape === 'burst' || p.saleShape === 'circle';
            const bw = round ? L.sale.size : Math.min(W * 0.45, L.sale.size * 1.75);
            const bh = saleBadgeHeight(p.saleShape, bw);
            const right = L.sale.x + L.sale.size;
            const bottomAnchored = L.sale.y + L.sale.size > H * 0.6;
            const by = bottomAnchored ? L.sale.y + L.sale.size - bh : round ? L.sale.y : L.sale.y + L.margin * 0.2;
            return <SaleBadge x={right - bw} y={by} size={bw} discount={p.discount} label={tiny ? '' : p.saleLabel} shape={p.saleShape} color={p.saleColor} fontFamily={p.bodyFont} />;
          })()
        : null}
      {L.callout && p.callout === 'wishlist' ? <WishlistCallout x={L.callout.x} y={L.callout.y} width={L.callout.width} height={L.callout.height} text={calloutText} color={p.accentColor} textColor="#140a05" fontFamily={p.bodyFont} /> : null}
      {L.callout && p.callout === 'demo' ? <DemoAvailableBadge x={L.callout.x} y={L.callout.y} width={L.callout.width} height={L.callout.height} text={calloutText} subtext="" fontFamily={p.bodyFont} /> : null}
      {p.showSafeZones ? <SafeZoneGuides zones={currentSafeZones(W, H)} /> : null}
    </div>
  );
}
