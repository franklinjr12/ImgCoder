import { Layer, Text, type ArtisanStyle, type Effect } from '@game-artisan/core';
import { withCjkFallback } from '../utils.js';

export type LaurelLeafStyle = 'classic' | 'modern' | 'pixel';

export interface LaurelProps {
  /** Top line, e.g. "OFFICIAL SELECTION", "WINNER", "NOMINEE". */
  text?: string;
  /** Festival / award name, e.g. "PIXEL HARBOR FEST" (the most prominent line). */
  title?: string;
  /** Year line (omitted when empty). */
  year?: string | number;
  leafStyle?: LaurelLeafStyle;
  /** Leaf + text colour. */
  color?: string;
  /** Text colour (defaults to `color`). */
  textColor?: string;
  fontFamily?: string;
  width: number;
  /** Defaults to width × 0.62. */
  height?: number;
  x?: number;
  y?: number;
  style?: ArtisanStyle;
  id?: string;
  effects?: Effect[];
  opacity?: number;
}

const f = (n: number) => (Math.round(n * 100) / 100).toString();

interface Pt {
  x: number;
  y: number;
}

/** Point + unit tangent on the branch arc (left branch; mirror for the right one). */
function arc(W: number, H: number, phi: number): { p: Pt; t: Pt } {
  const cx = W / 2;
  const cy = H * 0.44;
  const rx = W * 0.43;
  const ry = H * 0.5;
  const p = { x: cx - rx * Math.sin(phi), y: cy + ry * Math.cos(phi) };
  const dx = -rx * Math.cos(phi);
  const dy = -ry * Math.sin(phi);
  const l = Math.hypot(dx, dy) || 1;
  return { p, t: { x: dx / l, y: dy / l } };
}

const rot = (v: Pt, a: number): Pt => ({ x: v.x * Math.cos(a) - v.y * Math.sin(a), y: v.x * Math.sin(a) + v.y * Math.cos(a) });

function leafPath(base: Pt, dir: Pt, len: number, width: number, rounded: boolean): string {
  const tip = { x: base.x + dir.x * len, y: base.y + dir.y * len };
  const n = { x: -dir.y, y: dir.x };
  if (rounded) {
    const a = { x: base.x + dir.x * len * 0.15 + n.x * width, y: base.y + dir.y * len * 0.15 + n.y * width };
    const b = { x: base.x + dir.x * len * 0.85 + n.x * width, y: base.y + dir.y * len * 0.85 + n.y * width };
    const c = { x: base.x + dir.x * len * 0.85 - n.x * width, y: base.y + dir.y * len * 0.85 - n.y * width };
    const d = { x: base.x + dir.x * len * 0.15 - n.x * width, y: base.y + dir.y * len * 0.15 - n.y * width };
    return `M${f(base.x)} ${f(base.y)}C${f(a.x)} ${f(a.y)} ${f(b.x)} ${f(b.y)} ${f(tip.x)} ${f(tip.y)}C${f(c.x)} ${f(c.y)} ${f(d.x)} ${f(d.y)} ${f(base.x)} ${f(base.y)}Z`;
  }
  const mid = { x: base.x + dir.x * len * 0.45, y: base.y + dir.y * len * 0.45 };
  const c1 = { x: mid.x + n.x * width * 1.3, y: mid.y + n.y * width * 1.3 };
  const c2 = { x: mid.x - n.x * width * 1.3, y: mid.y - n.y * width * 1.3 };
  return `M${f(base.x)} ${f(base.y)}Q${f(c1.x)} ${f(c1.y)} ${f(tip.x)} ${f(tip.y)}Q${f(c2.x)} ${f(c2.y)} ${f(base.x)} ${f(base.y)}Z`;
}

const mirror = (p: Pt, W: number): Pt => ({ x: W - p.x, y: p.y });

/**
 * Generate both laurel branches as one SVG path (`d`, in the W×H box) for the given leaf style.
 * Exposed so custom badges can reuse the vector leaves.
 */
export function laurelBranchesPath(W: number, H: number, style: LaurelLeafStyle = 'classic'): string {
  const parts: string[] = [];
  const phiStart = 0.42;
  const phiEnd = 2.55;
  if (style === 'pixel') {
    const g = Math.max(1, H / 34);
    const cells = new Set<string>();
    const mark = (x: number, y: number) => cells.add(`${Math.floor(x / g)},${Math.floor(y / g)}`);
    // one-cell stem
    for (let i = 0; i <= 120; i++) {
      const { p } = arc(W, H, phiStart + ((phiEnd - phiStart) * i) / 120);
      mark(p.x, p.y);
    }
    // leaves alternate outward / inward along the stem, rasterised as chunky diamonds
    const count = 7;
    for (let i = 0; i < count; i++) {
      const phi = phiStart + 0.1 + ((phiEnd - phiStart - 0.16) * i) / (count - 1);
      const { p, t } = arc(W, H, phi);
      const side = i % 2 === 0 ? 1 : -1;
      const dir = rot(t, -side * 0.8);
      const len = H * 0.17 * (1 - (i / count) * 0.3);
      const n = { x: -dir.y, y: dir.x };
      for (let s = g; s <= len; s += g * 0.4) {
        const wHalf = Math.sin((s / len) * Math.PI) * H * 0.04;
        for (let w = -wHalf; w <= wHalf; w += g * 0.4) mark(p.x + dir.x * s + n.x * w, p.y + dir.y * s + n.y * w);
      }
    }
    for (const c of cells) {
      const [cx, cy] = c.split(',').map(Number);
      for (const x of [cx * g, W - (cx + 1) * g]) parts.push(`M${f(x)} ${f(cy * g)}h${f(g)}v${f(g)}h${f(-g)}Z`);
    }
    return parts.join('');
  }

  const rounded = style === 'modern';
  const count = rounded ? 6 : 8;
  // stem as a thin crescent (two offset arcs)
  const stemW = Math.max(0.6, H * (rounded ? 0.014 : 0.018));
  const steps = 40;
  const outer: Pt[] = [];
  const inner: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const phi = phiStart + ((phiEnd - phiStart) * i) / steps;
    const { p, t } = arc(W, H, phi);
    const n = { x: -t.y, y: t.x };
    const w = stemW * (1 - (i / steps) * 0.6);
    outer.push({ x: p.x + n.x * w, y: p.y + n.y * w });
    inner.push({ x: p.x - n.x * w, y: p.y - n.y * w });
  }
  const stem = (pts: Pt[], back: Pt[]) => `M${pts.map((q) => `${f(q.x)} ${f(q.y)}`).join('L')}L${[...back].reverse().map((q) => `${f(q.x)} ${f(q.y)}`).join('L')}Z`;
  parts.push(stem(outer, inner), stem(outer.map((q) => mirror(q, W)), inner.map((q) => mirror(q, W))));

  for (let i = 0; i < count; i++) {
    const prog = i / (count - 1);
    const phi = phiStart + 0.1 + (phiEnd - phiStart - 0.18) * prog;
    const { p, t } = arc(W, H, phi);
    const len = H * (rounded ? 0.2 : 0.22) * (1 - prog * 0.35);
    const width = len * (rounded ? 0.3 : 0.26);
    const sides = rounded ? [1] : [-1, 1];
    for (const side of sides) {
      // side 1 = outward (away from the wreath centre), -1 = inward
      const dir = rot(t, side * (rounded ? 0.95 : 0.62) * -1);
      const d = leafPath(p, dir, side === -1 ? len * 0.82 : len, width, rounded);
      parts.push(d);
      const mDir = { x: -dir.x, y: dir.y };
      parts.push(leafPath(mirror(p, W), mDir, side === -1 ? len * 0.82 : len, width, rounded));
    }
  }
  // crown leaves at the branch tips
  const tip = arc(W, H, phiEnd);
  const tlen = H * (rounded ? 0.14 : 0.16);
  parts.push(leafPath(tip.p, tip.t, tlen, tlen * 0.26, rounded));
  parts.push(leafPath(mirror(tip.p, W), { x: -tip.t.x, y: tip.t.y }, tlen, tlen * 0.26, rounded));
  return parts.join('');
}

/** Festival / award laurel with vector leaves (US-5.3). */
export function Laurel(p: LaurelProps) {
  const W = p.width;
  const H = p.height ?? Math.round(W * 0.62);
  const style = p.leafStyle ?? 'classic';
  const color = p.color ?? '#f5d27a';
  const textColor = p.textColor ?? color;
  const font = p.fontFamily ?? (style === 'pixel' ? 'Press Start 2P' : style === 'modern' ? 'Inter' : 'Cinzel');
  const pixel = style === 'pixel';
  const innerW = W * 0.52;
  const year = p.year != null && String(p.year).trim() !== '' ? String(p.year) : '';
  const titleH = H * (year ? 0.3 : 0.36);
  return (
    <Layer.Group
      id={p.id ?? 'laurel'}
      name="Laurel"
      opacity={p.opacity}
      effects={p.effects}
      style={{ position: 'absolute', ...(p.x != null ? { left: p.x } : {}), ...(p.y != null ? { top: p.y } : {}), width: W, height: H, ...(p.style ?? {}) }}
    >
      <Layer.Path name="Leaves" d={laurelBranchesPath(W, H, style)} fill={color} x={0} y={0} width={W} height={H} />
      <div
        className="Laurel text"
        style={{
          position: 'absolute',
          left: (W - innerW) / 2,
          top: H * 0.12,
          width: innerW,
          height: H * 0.7,
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          gap: H * 0.025,
          color: textColor,
          textAlign: 'center',
          fontFamily: withCjkFallback(font),
        }}
      >
        {p.text ? (
          <Text
            name="Laurel line"
            content={p.text}
            fit="shrink"
            maxLines={1}
            style={{ width: innerW, height: H * (pixel ? 0.09 : 0.11), fontSize: H * (pixel ? 0.07 : 0.095), fontWeight: style === 'modern' ? 700 : 700, letterSpacing: pixel ? 0 : H * 0.008, textTransform: 'uppercase', verticalAlign: 'middle' }}
          />
        ) : null}
        {p.title ? (
          <Text
            name="Laurel title"
            content={p.title}
            fit="shrink"
            maxLines={2}
            style={{ width: innerW, height: titleH, fontSize: H * (pixel ? 0.11 : 0.15), fontWeight: 900, lineHeight: 1.05, textTransform: 'uppercase', verticalAlign: 'middle' }}
          />
        ) : null}
        {year ? (
          <Text name="Laurel year" content={year} fit="shrink" maxLines={1} style={{ width: innerW, height: H * 0.11, fontSize: H * (pixel ? 0.07 : 0.1), fontWeight: 700, letterSpacing: pixel ? 0 : H * 0.01, verticalAlign: 'middle' }} />
        ) : null}
      </div>
    </Layer.Group>
  );
}
