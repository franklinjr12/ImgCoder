/**
 * Social / streaming templates: announcement cards (Twitter/X, Discord, YouTube) and a
 * transparent Twitch stream overlay.
 */
import { Layer, Text, getRenderContext } from '@game-artisan/core';
import { z } from 'zod';
import { BUILTIN_ART, resolveArt } from '../art.js';
import { resolveTitle } from '../components/LocalizedTitle.js';
import { ReviewQuote, SaleBadge, WishlistCallout } from '../components/badges.js';
import { ArtStage, SafeZoneGuides, Scrim, TitleLockup } from '../components/stage.js';
import { artShape, badgeShape, brandingShape, colorProp, imageProp } from '../schemas.js';
import { mixColors, stroke, withAlpha, withCjkFallback } from '../utils.js';
import { currentSafeZones, titleFill } from './KeyArtCapsule.js';

const CHARACTER_ASPECT = 0.6;

// -----------------------------------------------------------------------------------------
// Social announcement card

export const SocialCardSchema = z.object({
  ...brandingShape,
  ...artShape,
  kicker: brandingShape.kicker.default('Wishlist now'),
  tagline: brandingShape.tagline.default('Climb the floating ruins before the sky falls.'),
  headline: z.string().max(32).default('Coming 2026').describe('Big announcement tag (e.g. "Out now", "Demo live", "Coming 2026"); empty = none'),
  platformsText: z.string().max(80).default('PC · Mac · Linux').describe('Platforms / store line at the bottom (plain text, no store logos)'),
  callout: z.enum(['none', 'wishlist']).default('wishlist'),
  calloutText: z.string().max(32).default(''),
  quote: z.string().max(160).default('').describe('Optional press quote (plain text)'),
  quoteOutlet: z.string().max(40).default(''),
  quoteScore: z.string().max(12).default(''),
  discount: badgeShape.discount,
  saleLabel: badgeShape.saleLabel,
  saleShape: badgeShape.saleShape,
  saleColor: badgeShape.saleColor,
  showSafeZones: badgeShape.showSafeZones,
});
export type SocialCardProps = z.infer<typeof SocialCardSchema>;

/** Social announcement card: title lockup + headline tag + CTA + optional press quote. */
export function SocialCard(p: SocialCardProps) {
  const { width: W0, height: H0 } = getRenderContext();
  const W = W0 || 1200;
  const H = H0 || 675;
  const m = Math.round(H * 0.07);
  const t = resolveTitle(p.localeMap, { text: p.title, logo: p.logoUrl || undefined, tagline: p.tagline || undefined, kicker: p.kicker || undefined });
  const ch = H * 1.02 * p.characterScale;
  const cw = ch * CHARACTER_ASPECT;
  const cx = W * 0.73 + p.characterOffsetX * W;
  const headlineH = p.headline ? Math.round(H * 0.075) : 0;
  const ctaH = p.callout !== 'none' ? Math.round(H * 0.1) : 0;
  const footerH = p.platformsText ? Math.round(H * 0.05) : 0;
  const lockW = W * 0.55;
  const lockTop = m + (headlineH ? headlineH + m * 0.5 : 0);
  const lockBottom = H - m - footerH - (ctaH ? ctaH + m * 0.6 : 0) - m * 0.3;
  const quoteW = W * 0.3;
  const hasQuote = !!(p.quote && p.quoteOutlet);
  const saleSize = Math.round(H * 0.26);
  return (
    <div style={{ width: W, height: H, backgroundColor: '#07060f', overflow: 'hidden' }}>
      <ArtStage
        width={W}
        height={H}
        backgroundUrl={p.backgroundUrl}
        backgroundFocus={{ x: 0.6, y: 0.5 }}
        characterUrl={p.characterUrl}
        characterBox={{ x: cx - cw / 2, y: H - ch + H * 0.05, width: cw, height: ch }}
        grading={p.grading}
        glow={p.characterGlow}
        glowColor={p.glowColor}
        glowIntensity={p.glowIntensity}
        rimLight={p.rimLight}
      />
      <Scrim id="scrim-left" angle={90} extent={0.7} strength={0.85} />
      <Scrim id="scrim-bottom" angle={0} extent={0.3} strength={0.6} />
      {p.headline ? (
        <Layer.Group id="headline" name="Headline tag" style={{ position: 'absolute', left: m * 1.3, top: m, height: headlineH, paddingHorizontal: headlineH * 0.45, justifyContent: 'center', backgroundColor: p.accentColor, borderRadius: headlineH * 0.18 }}>
          <Text name="Headline" content={p.headline} style={{ fontFamily: withCjkFallback(p.bodyFont), fontSize: headlineH * 0.52, fontWeight: 900, letterSpacing: headlineH * 0.06, textTransform: 'uppercase', color: '#140a05', whiteSpace: 'nowrap' }} />
        </Layer.Group>
      ) : null}
      <TitleLockup
        box={{ x: m * 1.3, y: lockTop, width: lockW, height: lockBottom - lockTop }}
        align="left"
        anchor="center"
        kicker={t.kicker}
        title={p.title}
        logo={p.logoUrl || undefined}
        localeMap={p.localeMap}
        tagline={t.tagline}
        titleHeight={Math.min((lockBottom - lockTop) * 0.55, lockW * 0.36)}
        titleFont={p.titleFont}
        bodyFont={p.bodyFont}
        titleColor={p.titleColor}
        titleFill={titleFill(p.titleStyle, p.titleColor, p.accentColor)}
        titleStrokeColor={p.titleStyle === 'outline' ? '#0a0614' : undefined}
        accentColor={p.accentColor}
      />
      {ctaH ? <WishlistCallout x={m * 1.3} y={H - m - footerH - m * 0.4 - ctaH} width={ctaH * 4.2} height={ctaH} text={p.calloutText || undefined} color={p.accentColor} textColor="#140a05" fontFamily={p.bodyFont} /> : null}
      {footerH ? (
        <Text
          id="platforms"
          name="Platforms"
          content={p.platformsText}
          fit="shrink"
          maxLines={1}
          style={{ position: 'absolute', left: m * 1.3, top: H - m - footerH * 0.6, width: lockW, height: footerH, fontFamily: withCjkFallback(p.bodyFont), fontSize: footerH * 0.6, fontWeight: 700, letterSpacing: footerH * 0.08, textTransform: 'uppercase', color: 'rgba(255,255,255,0.72)', verticalAlign: 'middle' }}
        />
      ) : null}
      {hasQuote ? (
        <Layer.Group id="quote-card" name="Quote card" style={{ position: 'absolute', left: W - quoteW - m, top: H - m - quoteW * 0.5 - (p.discount > 0 ? saleSize + m * 0.5 : 0), width: quoteW, height: quoteW * 0.5, backgroundColor: 'rgba(8,6,20,0.72)', borderRadius: H * 0.02, border: `1px solid ${withAlpha(p.accentColor, 0.5)}` }}>
          <ReviewQuote x={quoteW * 0.07} y={quoteW * 0.03} width={quoteW * 0.86} height={quoteW * 0.44} quote={p.quote} outlet={p.quoteOutlet} score={p.quoteScore || undefined} accentColor={p.accentColor} fontFamily={p.bodyFont} />
        </Layer.Group>
      ) : null}
      {p.discount > 0 ? <SaleBadge x={W - saleSize - m} y={H - saleSize - m} size={saleSize} discount={p.discount} label={p.saleLabel} shape={p.saleShape} color={p.saleColor} fontFamily={p.bodyFont} /> : null}
      {p.showSafeZones ? <SafeZoneGuides zones={currentSafeZones(W, H)} /> : null}
    </div>
  );
}

// -----------------------------------------------------------------------------------------
// Twitch stream overlay

export const StreamOverlaySchema = z.object({
  title: brandingShape.title,
  logoUrl: brandingShape.logoUrl,
  localeMap: brandingShape.localeMap,
  titleFont: brandingShape.titleFont,
  bodyFont: brandingShape.bodyFont,
  accentColor: colorProp('#ffb36b'),
  panelColor: colorProp('rgba(10,8,24,0.86)', 'Bar / panel background'),
  emblemUrl: imageProp(BUILTIN_ART.logo, 'Emblem shown in the brand panel'),
  statusText: z.string().max(16).default('Live').describe('Status pill text (e.g. "Live", "Dev stream")'),
  nowPlayingLabel: z.string().max(24).default('Now playing'),
  handle: z.string().max(40).default('@skyboundrelic').describe('Social handle / channel name'),
  tickerText: z.string().max(120).default('Wishlist Skybound Relic — demo available now').describe('Bottom ticker line'),
  showWebcam: z.boolean().default(true),
  webcamPosition: z.enum(['bottom-right', 'bottom-left', 'top-right']).default('bottom-right'),
  webcamLabel: z.string().max(24).default(''),
  showSafeZones: z.boolean().default(false),
});
export type StreamOverlayProps = z.infer<typeof StreamOverlaySchema>;

/** Transparent Twitch / OBS overlay: brand panel, now-playing bar, webcam frame, ticker. */
export function StreamOverlay(p: StreamOverlayProps) {
  const { width: W0, height: H0 } = getRenderContext();
  const W = W0 || 1920;
  const H = H0 || 1080;
  const u = H / 1080;
  const barH = Math.round(84 * u);
  const m = Math.round(28 * u);
  const t = resolveTitle(p.localeMap, { text: p.title, logo: p.logoUrl || undefined });
  const emblem = resolveArt(p.emblemUrl);
  const camW = Math.round(480 * u);
  const camH = Math.round(270 * u);
  const camX = p.webcamPosition === 'bottom-left' ? m : W - camW - m;
  const camY = p.webcamPosition === 'top-right' ? m : H - barH - camH - m;
  const accentDark = mixColors(p.accentColor, '#000000', 0.82);
  const body = withCjkFallback(p.bodyFont);
  const brandW = Math.round(560 * u);
  const titleFill = `linear-gradient(180deg, #ffffff 0%, ${mixColors('#ffffff', p.accentColor, 0.6)} 100%)`;
  return (
    <div style={{ width: W, height: H }}>
      {/* corner brackets */}
      {[
        [m, m, 0],
        [W - m, m, 90],
        [W - m, H - barH - m, 180],
        [m, H - barH - m, 270],
      ]
        .filter((_, i) => !p.showWebcam || (p.webcamPosition === 'bottom-right' ? i !== 2 : p.webcamPosition === 'bottom-left' ? i !== 3 : i !== 1))
        .map(([x, y, r], i) => (
        <Layer.Path key={i} name={`Corner ${i + 1}`} d={`M0 ${60 * u}V0H${60 * u}`} fill={{ type: 'none' }} strokes={[stroke(p.accentColor, 5 * u, 'center')]} x={x - (r === 90 || r === 180 ? 60 * u : 0)} y={y - (r === 180 || r === 270 ? 60 * u : 0)} width={60 * u} height={60 * u} rotation={r} />
      ))}
      {/* brand panel */}
      <Layer.Group id="brand-panel" name="Brand panel" style={{ position: 'absolute', left: m + 20 * u, top: m + 20 * u, width: brandW, height: 120 * u, backgroundColor: p.panelColor, borderRadius: 14 * u, border: `${2 * u}px solid ${withAlpha(p.accentColor, 0.6)}` }}>
        {emblem ? <Layer.Image name="Emblem" src={emblem} fit="contain" x={14 * u} y={10 * u} width={100 * u} height={100 * u} /> : null}
        {t.logo ? (
          <Layer.Image name="Title logo" src={resolveArt(t.logo)!} fit="contain" position={{ x: 0, y: 0.5 }} x={130 * u} y={14 * u} width={brandW - 150 * u} height={92 * u} />
        ) : (
          <Text name="Title" content={t.text} fit="shrink" maxLines={2} fill={titleFill} style={{ position: 'absolute', left: 130 * u, top: 12 * u, width: brandW - 150 * u, height: 96 * u, fontFamily: withCjkFallback(p.titleFont), fontSize: 48 * u, fontWeight: 900, lineHeight: 1, verticalAlign: 'middle' }} />
        )}
      </Layer.Group>
      {/* status pill */}
      {p.statusText ? (
        <Layer.Group id="status" name="Status" style={{ position: 'absolute', left: m + 20 * u + brandW + 16 * u, top: m + 20 * u, height: 44 * u, paddingHorizontal: 18 * u, flexDirection: 'row', alignItems: 'center', gap: 10 * u, backgroundColor: '#e8173c', borderRadius: 22 * u }}>
          <Layer.Ellipse name="Dot" fill="#ffffff" style={{ width: 14 * u, height: 14 * u }} />
          <Text name="Status text" content={p.statusText} style={{ fontFamily: body, fontSize: 24 * u, fontWeight: 900, letterSpacing: 2 * u, textTransform: 'uppercase', color: '#ffffff', whiteSpace: 'nowrap' }} />
        </Layer.Group>
      ) : null}
      {/* webcam frame */}
      {p.showWebcam ? (
        <Layer.Group id="webcam" name="Webcam frame" style={{ position: 'absolute', left: camX, top: camY, width: camW, height: camH, borderRadius: 16 * u, border: `${6 * u}px solid ${p.accentColor}` }} effects={[{ type: 'outer-glow', color: p.accentColor, radius: 2 * u, blur: 18 * u, opacity: 0.6, blendMode: 'normal' }]}>
          {p.webcamLabel ? (
            <Layer.Group name="Webcam label" style={{ position: 'absolute', left: 16 * u, top: camH - 46 * u, height: 34 * u, paddingHorizontal: 12 * u, justifyContent: 'center', backgroundColor: p.panelColor, borderRadius: 8 * u }}>
              <Text name="Webcam label text" content={p.webcamLabel} style={{ fontFamily: body, fontSize: 20 * u, fontWeight: 700, color: '#ffffff', whiteSpace: 'nowrap' }} />
            </Layer.Group>
          ) : null}
        </Layer.Group>
      ) : null}
      {/* bottom bar */}
      <Layer.Group id="bottom-bar" name="Bottom bar" style={{ position: 'absolute', left: 0, top: H - barH, width: W, height: barH, backgroundColor: p.panelColor }}>
        <Layer.Rect name="Accent line" fill={p.accentColor} x={0} y={0} width={W} height={4 * u} />
        <Layer.Group name="Now playing" style={{ position: 'absolute', left: 0, top: 4 * u, width: 520 * u, height: barH - 4 * u, backgroundColor: accentDark, justifyContent: 'center', paddingHorizontal: 32 * u }}>
          <Text name="Now playing label" content={p.nowPlayingLabel} style={{ fontFamily: body, fontSize: 18 * u, fontWeight: 700, letterSpacing: 3 * u, textTransform: 'uppercase', color: p.accentColor, whiteSpace: 'nowrap' }} />
          <Text name="Now playing title" content={t.text} fit="shrink" maxLines={1} style={{ width: 456 * u, height: 40 * u, fontFamily: withCjkFallback(p.titleFont), fontSize: 34 * u, fontWeight: 900, color: '#ffffff', verticalAlign: 'middle' }} />
        </Layer.Group>
        <Text name="Ticker" content={p.tickerText} fit="shrink" maxLines={1} style={{ position: 'absolute', left: 560 * u, top: 4 * u, width: W - 560 * u - 460 * u, height: barH - 4 * u, fontFamily: body, fontSize: 28 * u, fontWeight: 700, color: '#ffffff', verticalAlign: 'middle' }} />
        <Text name="Handle" content={p.handle} fit="shrink" maxLines={1} style={{ position: 'absolute', left: W - 440 * u, top: 4 * u, width: 410 * u, height: barH - 4 * u, fontFamily: body, fontSize: 28 * u, fontWeight: 900, color: p.accentColor, textAlign: 'right', verticalAlign: 'middle' }} />
      </Layer.Group>
      {p.showSafeZones ? <SafeZoneGuides zones={currentSafeZones(W, H)} /> : null}
    </div>
  );
}
