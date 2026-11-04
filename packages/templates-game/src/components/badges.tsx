import { Layer, Shadow, Text, type ArtisanStyle, type Effect } from '@game-artisan/core';
import { shade, stroke, withCjkFallback } from '../utils.js';

interface Positioned {
  x?: number;
  y?: number;
  style?: ArtisanStyle;
  id?: string;
  rotation?: number;
  opacity?: number;
  effects?: Effect[];
}

const pos = (p: Positioned, w: number, h: number): ArtisanStyle => ({
  position: 'absolute',
  ...(p.x != null ? { left: p.x } : {}),
  ...(p.y != null ? { top: p.y } : {}),
  width: w,
  height: h,
  ...(p.style ?? {}),
});

const f = (n: number) => (Math.round(n * 100) / 100).toString();

/** Format a discount: 50 → "-50%", "-50%" stays, "FREE" stays. */
export function formatDiscount(discount: number | string | undefined): string {
  if (discount == null || discount === '') return '';
  if (typeof discount === 'number') return `-${Math.abs(Math.round(discount))}%`;
  const s = discount.trim();
  return /^\d+(\.\d+)?$/.test(s) ? `-${s}%` : s;
}

// -----------------------------------------------------------------------------------------
// Sale badge

export type SaleBadgeShape = 'burst' | 'tag' | 'ribbon' | 'circle' | 'pill';

export interface SaleBadgeProps extends Positioned {
  /** 50 → "-50%"; strings are used verbatim ("FREE", "-75%"). */
  discount?: number | string;
  /** Small caption line, e.g. "SALE", "WEEKEND DEAL". Empty = none. */
  label?: string;
  shape?: SaleBadgeShape;
  color?: string;
  textColor?: string;
  fontFamily?: string;
  /** Badge width in px (height derives from the shape). */
  size: number;
}

export function saleBadgeHeight(shape: SaleBadgeShape, size: number): number {
  return shape === 'burst' || shape === 'circle' ? size : shape === 'tag' ? Math.round(size * 0.46) : shape === 'ribbon' ? Math.round(size * 0.4) : Math.round(size * 0.36);
}

/** Price-drop badge: "-50%" in a starburst, price tag, ribbon, circle or pill (US-5.3). */
export function SaleBadge(p: SaleBadgeProps) {
  const shape = p.shape ?? 'burst';
  const W = p.size;
  const H = saleBadgeHeight(shape, W);
  const color = p.color ?? '#ff2e63';
  const textColor = p.textColor ?? '#ffffff';
  const font = withCjkFallback(p.fontFamily ?? 'Inter');
  const text = formatDiscount(p.discount ?? 50);
  const label = p.label ?? '';
  const effects = p.effects ?? [Shadow.drop({ y: Math.max(1, H * 0.04), blur: Math.max(1, H * 0.08), color: 'rgba(0,0,0,0.55)' })];
  const round = shape === 'burst' || shape === 'circle';
  // content box inside the shape
  const box = round
    ? { left: W * 0.17, top: H * 0.2, width: W * 0.66, height: H * 0.6 }
    : shape === 'tag'
      ? { left: W * 0.24, top: H * 0.1, width: W * 0.7, height: H * 0.8 }
      : shape === 'ribbon'
        ? { left: W * 0.07, top: H * 0.1, width: W * 0.76, height: H * 0.8 }
        : { left: W * 0.08, top: H * 0.1, width: W * 0.84, height: H * 0.8 };
  let bg;
  if (shape === 'burst') bg = <Layer.Star name="Burst" points={18} innerRatio={0.84} fill={color} x={0} y={0} width={W} height={H} strokes={[stroke(shade(color, 0.35), Math.max(1, W * 0.015), 'center')]} />;
  else if (shape === 'circle') bg = <Layer.Ellipse name="Circle" fill={color} x={0} y={0} width={W} height={H} strokes={[stroke('#ffffff', Math.max(1, W * 0.025), 'center', 0.85)]} />;
  else if (shape === 'tag') {
    const n = H * 0.5;
    const r = H * 0.16;
    const hole = `M${f(n * 0.62 + r * 0.45)} ${f(H / 2)}A${f(r * 0.45)} ${f(r * 0.45)} 0 1 0 ${f(n * 0.62 - r * 0.45)} ${f(H / 2)}A${f(r * 0.45)} ${f(r * 0.45)} 0 1 0 ${f(n * 0.62 + r * 0.45)} ${f(H / 2)}Z`;
    const d = `M0 ${f(H / 2)}L${f(n)} 0H${f(W - r)}Q${f(W)} 0 ${f(W)} ${f(r)}V${f(H - r)}Q${f(W)} ${f(H)} ${f(W - r)} ${f(H)}H${f(n)}Z${hole}`;
    bg = <Layer.Path name="Tag" d={d} fillRule="evenodd" fill={color} x={0} y={0} width={W} height={H} />;
  } else if (shape === 'ribbon') {
    const notch = H * 0.45;
    const d = `M0 0H${f(W)}L${f(W - notch)} ${f(H / 2)}L${f(W)} ${f(H)}H0Z`;
    bg = <Layer.Path name="Ribbon" d={d} fill={color} x={0} y={0} width={W} height={H} />;
  } else bg = <Layer.Rect name="Pill" cornerRadius={H / 2} fill={color} x={0} y={0} width={W} height={H} />;

  const stacked = !!label && (round || H > 40);
  return (
    <Layer.Group id={p.id ?? 'sale-badge'} name="Sale badge" rotation={p.rotation ?? (shape === 'burst' ? -8 : 0)} opacity={p.opacity} effects={effects} style={pos(p, W, H)}>
      {bg}
      <div
        className="Sale text"
        style={{ position: 'absolute', ...box, flexDirection: stacked ? 'column' : 'row', justifyContent: 'center', alignItems: 'center', gap: stacked ? 0 : box.height * 0.12, color: textColor, fontFamily: font, textAlign: 'center' }}
      >
        {label ? (
          <Text
            name="Sale label"
            content={label}
            fit="shrink"
            maxLines={1}
            style={{ width: stacked ? box.width : box.width * 0.42, height: stacked ? box.height * 0.26 : box.height * 0.5, fontSize: box.height * (stacked ? 0.22 : 0.42), fontWeight: 700, letterSpacing: box.height * 0.01, textTransform: 'uppercase', verticalAlign: 'middle' }}
          />
        ) : null}
        <Text
          name="Discount"
          content={text}
          fit="shrink"
          maxLines={1}
          style={{ width: stacked || !label ? box.width : box.width * 0.55, height: stacked ? box.height * 0.6 : box.height, fontSize: box.height * (stacked ? 0.56 : 0.86), fontWeight: 900, letterSpacing: -box.height * 0.01, verticalAlign: 'middle' }}
        />
      </div>
    </Layer.Group>
  );
}

// -----------------------------------------------------------------------------------------
// Wishlist callout

const HEART = 'M12 21C12 21 3 14.5 3 8.6C3 5.5 5.4 3.5 8 3.5C9.7 3.5 11.1 4.4 12 5.7C12.9 4.4 14.3 3.5 16 3.5C18.6 3.5 21 5.5 21 8.6C21 14.5 12 21 12 21Z';
const PLAY = 'M7 4.5L20 12L7 19.5Z';

export interface WishlistCalloutProps extends Positioned {
  text?: string;
  /** Secondary line, e.g. "Coming 2026" (empty = none). */
  subtext?: string;
  color?: string;
  textColor?: string;
  variant?: 'solid' | 'outline' | 'glass';
  fontFamily?: string;
  width: number;
  height?: number;
  /** Icon: heart (default), star, plus or none. */
  icon?: 'heart' | 'star' | 'plus' | 'none';
}

function CalloutPill(props: {
  p: Positioned;
  W: number;
  H: number;
  id: string;
  name: string;
  color: string;
  textColor: string;
  variant: 'solid' | 'outline' | 'glass';
  iconD?: string;
  iconStar?: boolean;
  text: string;
  subtext?: string;
  font: string;
  /** The component's default solid-variant text colour (replaced by white for outline/glass). */
  solidTextDefault: string;
}) {
  const { W, H, color, variant } = props;
  // Outline / glass variants sit on artwork: light text unless explicitly overridden.
  const textColor = variant === 'solid' ? props.textColor : props.textColor === props.solidTextDefault ? '#ffffff' : props.textColor;
  const fill = variant === 'solid' ? color : variant === 'glass' ? 'rgba(10,12,24,0.55)' : 'rgba(0,0,0,0)';
  const strokes = variant === 'solid' ? [] : [stroke(color, Math.max(1, H * 0.05), 'center')];
  const hasIcon = !!props.iconD || !!props.iconStar;
  const iconS = H * 0.46;
  const padX = H * 0.36;
  const textW = W - padX * 2 - (hasIcon ? iconS + H * 0.22 : 0);
  const sub = props.subtext ?? '';
  return (
    <Layer.Group id={props.id} name={props.name} rotation={props.p.rotation} opacity={props.p.opacity} effects={props.p.effects ?? [Shadow.drop({ y: H * 0.06, blur: H * 0.18, color: 'rgba(0,0,0,0.45)' })]} style={pos(props.p, W, H)}>
      <Layer.Rect name="Callout background" cornerRadius={H * 0.22} fill={fill} strokes={strokes} x={0} y={0} width={W} height={H} />
      <div className="Callout content" style={{ position: 'absolute', left: padX, top: 0, width: W - padX * 2, height: H, flexDirection: 'row', alignItems: 'center', gap: H * 0.22, color: textColor, fontFamily: props.font }}>
        {props.iconStar ? (
          <Layer.Star name="Icon" points={5} innerRatio={0.48} fill={variant === 'solid' ? textColor : color} style={{ width: iconS, height: iconS }} />
        ) : props.iconD ? (
          <Layer.Path name="Icon" d={props.iconD} viewBox={[0, 0, 24, 24]} fill={variant === 'solid' ? textColor : color} style={{ width: iconS, height: iconS }} />
        ) : null}
        <div className="Callout text" style={{ width: textW, height: H * 0.8, flexDirection: 'column', justifyContent: 'center' }}>
          <Text
            name="Callout title"
            content={props.text}
            fit="shrink"
            maxLines={1}
            style={{ width: textW, height: sub ? H * 0.42 : H * 0.6, fontSize: H * (sub ? 0.34 : 0.4), fontWeight: 900, letterSpacing: H * 0.02, textTransform: 'uppercase', verticalAlign: 'middle' }}
          />
          {sub ? <Text name="Callout subtext" content={sub} fit="shrink" maxLines={1} style={{ width: textW, height: H * 0.28, fontSize: H * 0.22, fontWeight: 400, opacity: 0.85, verticalAlign: 'middle' }} /> : null}
        </div>
      </div>
    </Layer.Group>
  );
}

/** "Wishlist now" call-to-action (text only — no store logos). */
export function WishlistCallout(p: WishlistCalloutProps) {
  const H = p.height ?? Math.round(p.width * 0.24);
  const icon = p.icon ?? 'heart';
  return (
    <CalloutPill
      p={p}
      W={p.width}
      H={H}
      id={p.id ?? 'wishlist-callout'}
      name="Wishlist callout"
      color={p.color ?? '#ff4d6d'}
      textColor={p.textColor ?? '#ffffff'}
      solidTextDefault="#ffffff"
      variant={p.variant ?? 'solid'}
      iconD={icon === 'heart' ? HEART : icon === 'plus' ? 'M10 3H14V10H21V14H14V21H10V14H3V10H10Z' : undefined}
      iconStar={icon === 'star'}
      text={p.text ?? 'Wishlist now'}
      subtext={p.subtext}
      font={withCjkFallback(p.fontFamily ?? 'Inter')}
    />
  );
}

export interface DemoAvailableBadgeProps extends Positioned {
  text?: string;
  subtext?: string;
  color?: string;
  textColor?: string;
  variant?: 'solid' | 'outline' | 'glass';
  fontFamily?: string;
  width: number;
  height?: number;
}

/** "Demo available" badge with a play glyph. */
export function DemoAvailableBadge(p: DemoAvailableBadgeProps) {
  const H = p.height ?? Math.round(p.width * 0.24);
  return (
    <CalloutPill
      p={p}
      W={p.width}
      H={H}
      id={p.id ?? 'demo-badge'}
      name="Demo available badge"
      color={p.color ?? '#2ee6a6'}
      textColor={p.textColor ?? '#06221a'}
      solidTextDefault="#06221a"
      variant={p.variant ?? 'solid'}
      iconD={PLAY}
      text={p.text ?? 'Demo available'}
      subtext={p.subtext ?? 'Play free now'}
      font={withCjkFallback(p.fontFamily ?? 'Inter')}
    />
  );
}

// -----------------------------------------------------------------------------------------
// Review quote

export interface ReviewQuoteProps extends Positioned {
  quote: string;
  /** Publication name, rendered as plain text (never a logo). */
  outlet: string;
  /** e.g. "9/10", "95%", "5/5". Empty = none. */
  score?: string;
  /** 0..5 stars (halves allowed). Omit for none. */
  stars?: number;
  width: number;
  height?: number;
  align?: 'left' | 'center';
  color?: string;
  accentColor?: string;
  fontFamily?: string;
  quoteFontFamily?: string;
}

/** Press quote block: “quote” — OUTLET  [9/10] ★★★★★ (plain text, no outlet logos). */
export function ReviewQuote(p: ReviewQuoteProps) {
  const W = p.width;
  const H = p.height ?? Math.round(W * 0.42);
  const color = p.color ?? '#ffffff';
  const accent = p.accentColor ?? '#ffd166';
  const center = (p.align ?? 'left') === 'center';
  const u = H / 10;
  const stars = p.stars != null ? Math.max(0, Math.min(5, p.stars)) : null;
  const starS = u * 1.1;
  const quoteMark = 'M2 14C2 8 5 4 10 3L11 5C8 6.2 6.8 8.4 6.8 10.6H10.5V19H2ZM13.5 14C13.5 8 16.5 4 21.5 3L22.5 5C19.5 6.2 18.3 8.4 18.3 10.6H22V19H13.5Z';
  return (
    <Layer.Group id={p.id ?? 'review-quote'} name="Review quote" rotation={p.rotation} opacity={p.opacity} effects={p.effects} style={pos(p, W, H)}>
      <div className="Quote layout" style={{ position: 'absolute', left: 0, top: 0, width: W, height: H, flexDirection: 'column', justifyContent: 'center', alignItems: center ? 'center' : 'flex-start', gap: u * 0.5, color, fontFamily: withCjkFallback(p.fontFamily ?? 'Inter') }}>
        <Layer.Path name="Quote mark" d={quoteMark} viewBox={[0, 0, 24, 24]} fill={accent} style={{ width: u * 1.8, height: u * 1.8 }} />
        <Text
          name="Quote"
          content={p.quote}
          fit="shrink"
          maxLines={3}
          style={{ width: W, height: u * 4.2, fontSize: u * 1.5, fontWeight: 700, fontStyle: 'italic', lineHeight: 1.15, textAlign: center ? 'center' : 'left', verticalAlign: 'middle', fontFamily: withCjkFallback(p.quoteFontFamily ?? p.fontFamily ?? 'Inter') }}
        />
        <div className="Attribution" style={{ flexDirection: 'row', alignItems: 'center', gap: u * 0.6, height: u * 1.6 }}>
          {stars != null
            ? [0, 1, 2, 3, 4].map((i) => {
                const frac = Math.max(0, Math.min(1, stars - i));
                const fillW = frac >= 0.75 ? 1 : frac >= 0.25 ? 0.5 : 0;
                return (
                  <Layer.Group key={i} name={`Star ${i + 1}`} style={{ width: starS, height: starS, marginRight: -u * 0.4 }}>
                    <Layer.Star name="Star empty" points={5} innerRatio={0.48} fill="rgba(255,255,255,0.25)" x={0} y={0} width={starS} height={starS} />
                    {fillW > 0 ? (
                      <Layer.Group name="Star fill" clip style={{ position: 'absolute', left: 0, top: 0, width: starS * fillW, height: starS }}>
                        <Layer.Star name="Star" points={5} innerRatio={0.48} fill={accent} x={0} y={0} width={starS} height={starS} />
                      </Layer.Group>
                    ) : null}
                  </Layer.Group>
                );
              })
            : null}
          {p.score ? (
            <Layer.Group name="Score" style={{ height: u * 1.6, paddingHorizontal: u * 0.5, justifyContent: 'center', backgroundColor: accent, borderRadius: u * 0.3, marginLeft: stars != null ? u * 0.5 : 0 }}>
              <Text name="Score text" content={p.score} style={{ fontSize: u * 1.05, fontWeight: 900, color: '#111111', whiteSpace: 'nowrap' }} />
            </Layer.Group>
          ) : null}
          <Text name="Outlet" content={`— ${p.outlet}`} style={{ fontSize: u * 1.0, fontWeight: 700, letterSpacing: u * 0.08, textTransform: 'uppercase', opacity: 0.9, whiteSpace: 'nowrap' }} />
        </div>
      </div>
    </Layer.Group>
  );
}

// -----------------------------------------------------------------------------------------
// Age rating placeholder blocks

export type RatingSystem = 'ESRB' | 'PEGI' | 'USK' | 'generic';

export interface AgeRatingBlockProps extends Positioned {
  system?: RatingSystem;
  /** Rating string, e.g. "T", "M", "12", "16", "RP". */
  rating: string;
  /** Content descriptors listed next to the block (empty = none). */
  descriptors?: string[];
  /** Height of the rating block in px; width derives from it. */
  size: number;
  color?: string;
  background?: string;
  fontFamily?: string;
}

/**
 * Generic, clearly-placeholder age-rating layout block labelled ESRB / PEGI / USK. It is NOT the
 * official rating artwork (swap in the licensed mark from the rating board for final assets).
 */
export function AgeRatingBlock(p: AgeRatingBlockProps) {
  const H = p.size;
  const blockW = Math.round(H * 0.74);
  const desc = p.descriptors ?? [];
  const descW = desc.length ? Math.round(H * 1.5) : 0;
  const W = blockW + (desc.length ? descW + H * 0.06 : 0);
  const color = p.color ?? '#111111';
  const bg = p.background ?? '#ffffff';
  const system = p.system ?? 'generic';
  const label = system === 'generic' ? 'RATING' : system;
  const bw = Math.max(1, H * 0.035);
  const font = withCjkFallback(p.fontFamily ?? 'Inter');
  return (
    <Layer.Group id={p.id ?? 'age-rating'} name={`Age rating (${label} placeholder)`} rotation={p.rotation} opacity={p.opacity} effects={p.effects} style={pos(p, W, H)}>
      <Layer.Rect name="Rating block" fill={bg} strokes={[stroke(color, bw, 'center')]} cornerRadius={H * 0.04} x={0} y={0} width={blockW} height={H} />
      <Text name="Rating" content={p.rating} fit="shrink" maxLines={1} style={{ position: 'absolute', left: bw, top: H * 0.06, width: blockW - bw * 2, height: H * 0.62, fontFamily: font, fontSize: H * 0.5, fontWeight: 900, color, textAlign: 'center', verticalAlign: 'middle' }} />
      <Layer.Rect name="System strip" fill={color} x={0} y={H * 0.74} width={blockW} height={H * 0.26} cornerRadius={[0, 0, H * 0.04, H * 0.04]} />
      <Text name="System" content={label} fit="shrink" maxLines={1} style={{ position: 'absolute', left: H * 0.04, top: H * 0.75, width: blockW - H * 0.08, height: H * 0.24, fontFamily: font, fontSize: H * 0.15, fontWeight: 900, letterSpacing: H * 0.01, color: bg, textAlign: 'center', verticalAlign: 'middle' }} />
      {desc.length ? (
        <Layer.Group name="Descriptors" style={{ position: 'absolute', left: blockW + H * 0.06, top: 0, width: descW, height: H, backgroundColor: bg, borderRadius: H * 0.04, border: `${bw}px solid ${color}` }}>
          <Text
            name="Descriptor list"
            content={desc.join('\n')}
            fit="shrink"
            style={{ position: 'absolute', left: H * 0.08, top: H * 0.06, width: descW - H * 0.16, height: H * 0.88, fontFamily: font, fontSize: H * 0.13, fontWeight: 700, lineHeight: 1.2, color, verticalAlign: 'middle' }}
          />
        </Layer.Group>
      ) : null}
    </Layer.Group>
  );
}
