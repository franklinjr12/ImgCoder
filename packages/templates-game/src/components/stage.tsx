/**
 * Shared template building blocks: graded art stage (background + character cutout with glow),
 * title lockup and safe-zone guides.
 */
import { Layer, Text, type ArtisanStyle, type Effect, type SafeZone } from '@game-artisan/core';
import { resolveArt } from '../art.js';
import { characterGlow, gradingAdjustments, stroke, withCjkFallback, type GradingName } from '../utils.js';
import { LocalizedTitle, type TitleLocaleMap } from './LocalizedTitle.js';

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ArtStageProps {
  width: number;
  height: number;
  backgroundUrl?: string;
  /** Focal point of the background (0..1). */
  backgroundFocus?: { x: number; y: number };
  characterUrl?: string;
  /** Character box in canvas px (image is contained & anchored bottom-centre inside it). */
  characterBox?: Box;
  characterAnchor?: { x: number; y: number };
  grading?: GradingName;
  glow?: boolean;
  glowColor?: string;
  glowIntensity?: number;
  /** Extra rim light on the character (US-7.3). */
  rimLight?: boolean;
  rimColor?: string;
  pixelated?: boolean;
  /** Extra layers inside the graded group (above background, below character). */
  midground?: unknown;
}

/** Background + character composited in one group so grading presets apply to the art only. */
export function ArtStage(p: ArtStageProps) {
  const W = p.width;
  const H = p.height;
  const bg = resolveArt(p.backgroundUrl);
  const ch = resolveArt(p.characterUrl);
  const cb = p.characterBox;
  const fx: Effect[] = [];
  if (cb) {
    fx.push(...characterGlow(p.glow ?? true, p.glowColor ?? '#ffb36b', p.glowIntensity ?? 40, cb.height));
    if (p.rimLight) fx.push({ type: 'rim-light', color: p.rimColor ?? '#ffe0b0', width: Math.max(1, cb.height / 220), blur: Math.max(0.5, cb.height / 500), angle: 45, opacity: 0.9, blendMode: 'screen' });
  }
  return (
    <Layer.Group id="art" name="Art (graded)" adjustments={gradingAdjustments(p.grading, Math.min(W, H))} style={{ position: 'absolute', left: 0, top: 0, width: W, height: H }}>
      {bg ? (
        <Layer.Image
          id="background"
          name="Background"
          src={bg}
          fit="cover"
          position={p.backgroundFocus ?? { x: 0.5, y: 0.5 }}
          rendering={p.pixelated ? 'pixelated' : 'auto'}
          x={0}
          y={0}
          width={W}
          height={H}
        />
      ) : null}
      {p.midground ?? null}
      {ch && cb ? (
        <Layer.Image
          id="character"
          name="Character"
          src={ch}
          fit="contain"
          position={p.characterAnchor ?? { x: 0.5, y: 1 }}
          rendering={p.pixelated ? 'pixelated' : 'auto'}
          x={cb.x}
          y={cb.y}
          width={cb.width}
          height={cb.height}
          effects={fx}
        />
      ) : null}
    </Layer.Group>
  );
}

export interface TitleLockupProps {
  box: Box;
  align?: 'left' | 'center' | 'right';
  /** Vertical anchoring of the stack inside the box. */
  anchor?: 'top' | 'center' | 'bottom';
  kicker?: string;
  title: string;
  logo?: string;
  localeMap?: TitleLocaleMap;
  /** Already-localized tagline (empty = none). */
  tagline?: string;
  titleHeight: number;
  titleFont?: string;
  titleColor?: string;
  /** CSS gradient / colour fill for the title text. */
  titleFill?: string;
  titleStrokeColor?: string;
  titleWeight?: number;
  titleLetterSpacing?: number;
  titleMaxLines?: number;
  bodyFont?: string;
  accentColor?: string;
  kickerSize?: number;
  taglineSize?: number;
  taglineColor?: string;
  gap?: number;
  shadow?: boolean;
}

/** Kicker (genre) + localized title + tagline, stacked and anchored in a box. */
export function TitleLockup(p: TitleLockupProps) {
  const { box } = p;
  const align = p.align ?? 'left';
  const tagline = p.tagline ?? '';
  const titleH = p.titleHeight;
  const kickerSize = p.kickerSize ?? Math.max(7, titleH * 0.16);
  const taglineSize = p.taglineSize ?? Math.max(7, titleH * 0.17);
  const gap = p.gap ?? titleH * 0.06;
  const shadow = p.shadow !== false;
  const strokeW = Math.max(0.6, titleH * 0.025);
  const titleEffects: Effect[] = shadow ? [{ type: 'drop-shadow', x: 0, y: Math.max(1, titleH * 0.04), blur: Math.max(1, titleH * 0.1), spread: 0, color: 'rgba(0,0,0,0.7)', opacity: 1 }] : [];
  const items = align === 'center' ? 'center' : align === 'right' ? 'flex-end' : 'flex-start';
  const justify = p.anchor === 'top' ? 'flex-start' : p.anchor === 'center' ? 'center' : 'flex-end';
  const bodyFont = withCjkFallback(p.bodyFont ?? 'Inter');
  return (
    <div
      className="Title lockup"
      style={{ position: 'absolute', left: box.x, top: box.y, width: box.width, height: box.height, flexDirection: 'column', justifyContent: justify, alignItems: items, gap }}
    >
      {p.kicker ? (
        <Text
          id="kicker"
          name="Kicker"
          content={p.kicker}
         
          style={{ width: box.width, fontFamily: bodyFont, fontSize: kickerSize, fontWeight: 900, letterSpacing: kickerSize * 0.22, textTransform: 'uppercase', color: p.accentColor ?? '#ffb36b', textAlign: align, textShadow: shadow ? `0 1px ${Math.max(1, kickerSize * 0.3)}px rgba(0,0,0,0.8)` : undefined }}
          maxLines={1}
          fit="shrink"
        />
      ) : null}
      <LocalizedTitle
        localeMap={p.localeMap}
        text={p.title}
        logo={p.logo}
        width={box.width}
        height={titleH}
        style={{ position: 'relative' }}
        fontFamily={p.titleFont ?? 'Cinzel'}
        fontWeight={p.titleWeight ?? 900}
        color={p.titleColor ?? '#ffffff'}
        fill={p.titleFill}
        letterSpacing={p.titleLetterSpacing ?? titleH * 0.01}
        textAlign={align}
        verticalAlign={p.anchor === 'top' ? 'top' : p.anchor === 'center' ? 'middle' : 'bottom'}
        maxLines={p.titleMaxLines ?? 2}
        strokes={p.titleStrokeColor ? [stroke(p.titleStrokeColor, strokeW)] : undefined}
        effects={titleEffects}
      />
      {tagline ? (
        <Text
          id="tagline"
          name="Tagline"
          content={tagline}
          maxLines={2}
          style={{ width: box.width, fontFamily: bodyFont, fontSize: taglineSize, fontWeight: 700, lineHeight: 1.25, color: p.taglineColor ?? 'rgba(255,255,255,0.88)', textAlign: align, textShadow: shadow ? `0 1px ${Math.max(1, taglineSize * 0.35)}px rgba(0,0,0,0.85)` : undefined }}
        />
      ) : null}
    </div>
  );
}

export interface SafeZoneGuidesProps {
  zones: SafeZone[];
  /** Label font size (0 = no labels). */
  labelSize?: number;
}

const ZONE_COLORS: Record<SafeZone['kind'], string> = { safe: '#21d07a', danger: '#ff3b5c', overlay: '#3ba7ff' };

/** Visual overlay of safe / danger / UI zones (toggle with a template's `showSafeZones` prop). */
export function SafeZoneGuides(p: SafeZoneGuidesProps) {
  return (
    <Layer.Group id="safe-zones" name="Safe zone guides" style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%' }}>
      {p.zones.map((z) => {
        const c = ZONE_COLORS[z.kind] ?? '#ffffff';
        const lw = Math.max(1, Math.min(z.width, z.height) / 150);
        const ls = p.labelSize ?? Math.max(10, Math.min(z.width, z.height) / 14);
        return (
          <Layer.Group key={z.id} name={`Zone: ${z.label ?? z.id}`} style={{ position: 'absolute', left: z.x, top: z.y, width: z.width, height: z.height }}>
            <Layer.Rect name="Zone" x={0} y={0} width={z.width} height={z.height} fill={z.kind === 'safe' ? 'rgba(0,0,0,0)' : `${c}33`} strokes={[{ color: c, width: lw * 2, dash: [lw * 8, lw * 5], cap: 'butt', join: 'miter', align: 'center' }]} />
            {ls > 0 ? <Text name="Zone label" content={`${z.kind.toUpperCase()} · ${z.label ?? z.id}`} style={{ position: 'absolute', left: lw * 6, top: lw * 5, fontFamily: 'Inter', fontSize: ls, fontWeight: 700, color: c, whiteSpace: 'nowrap' }} /> : null}
          </Layer.Group>
        );
      })}
    </Layer.Group>
  );
}

/** Readability scrim: CSS-angle linear gradient from `color` (opaque side) to transparent. */
export function Scrim(p: { angle: number; color?: string; strength?: number; extent?: number; id?: string; style?: ArtisanStyle }) {
  const c = p.color ?? '#05040c';
  const s = p.strength ?? 0.85;
  const e = p.extent ?? 0.6;
  const rgba = (a: number) => {
    const hex = c.replace('#', '');
    const n = parseInt(hex.length === 3 ? hex.split('').map((x) => x + x).join('') : hex.slice(0, 6), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.round(a * 1000) / 1000})`;
  };
  return (
    <Layer.Gradient
      id={p.id}
      name="Scrim"
      type="linear"
      angle={p.angle}
      colors={[rgba(s), rgba(s * 0.55), rgba(0)]}
      stops={[0, e * 0.5, e]}
      style={p.style}
    />
  );
}
