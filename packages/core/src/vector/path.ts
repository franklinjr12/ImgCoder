import { applyToPoint, boundsOfPoints, type Matrix, type Point, type Rect } from '../math/matrix.js';

/** Absolute, normalised path segment set: every path is reduced to M/L/C/Q/Z. */
export type PathSegment =
  | { type: 'M'; x: number; y: number }
  | { type: 'L'; x: number; y: number }
  | { type: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { type: 'Q'; x1: number; y1: number; x: number; y: number }
  | { type: 'Z' };

const fmt = (n: number) => {
  const r = Math.round(n * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
};

/** Fluent path builder producing SVG `d` strings. */
export class PathBuilder {
  readonly segments: PathSegment[] = [];
  private cx = 0;
  private cy = 0;
  private sx = 0;
  private sy = 0;

  moveTo(x: number, y: number): this {
    this.segments.push({ type: 'M', x, y });
    this.cx = this.sx = x;
    this.cy = this.sy = y;
    return this;
  }
  lineTo(x: number, y: number): this {
    this.segments.push({ type: 'L', x, y });
    this.cx = x;
    this.cy = y;
    return this;
  }
  horizontalTo(x: number): this {
    return this.lineTo(x, this.cy);
  }
  verticalTo(y: number): this {
    return this.lineTo(this.cx, y);
  }
  cubicTo(x1: number, y1: number, x2: number, y2: number, x: number, y: number): this {
    this.segments.push({ type: 'C', x1, y1, x2, y2, x, y });
    this.cx = x;
    this.cy = y;
    return this;
  }
  quadTo(x1: number, y1: number, x: number, y: number): this {
    this.segments.push({ type: 'Q', x1, y1, x, y });
    this.cx = x;
    this.cy = y;
    return this;
  }
  /** SVG elliptical arc, converted to cubic Béziers. */
  arcTo(rx: number, ry: number, xAxisRotation: number, largeArc: boolean, sweep: boolean, x: number, y: number): this {
    for (const c of arcToCubics(this.cx, this.cy, rx, ry, xAxisRotation, largeArc, sweep, x, y)) {
      this.cubicTo(c[0], c[1], c[2], c[3], c[4], c[5]);
    }
    this.cx = x;
    this.cy = y;
    return this;
  }
  close(): this {
    this.segments.push({ type: 'Z' });
    this.cx = this.sx;
    this.cy = this.sy;
    return this;
  }
  /** Append another path's segments. */
  append(other: PathBuilder | PathSegment[]): this {
    const segs = other instanceof PathBuilder ? other.segments : other;
    for (const s of segs) {
      this.segments.push({ ...s } as PathSegment);
      if (s.type !== 'Z') {
        this.cx = s.x;
        this.cy = s.y;
        if (s.type === 'M') {
          this.sx = s.x;
          this.sy = s.y;
        }
      }
    }
    return this;
  }
  transform(m: Matrix): PathBuilder {
    return PathBuilder.from(transformSegments(this.segments, m));
  }
  bounds(): Rect {
    return segmentsBounds(this.segments);
  }
  toString(): string {
    return segmentsToD(this.segments);
  }
  toD(): string {
    return this.toString();
  }
  static from(segments: PathSegment[]): PathBuilder {
    return new PathBuilder().append(segments);
  }
  static parse(d: string): PathBuilder {
    return PathBuilder.from(parsePath(d));
  }
}

export function segmentsToD(segments: PathSegment[]): string {
  const out: string[] = [];
  for (const s of segments) {
    switch (s.type) {
      case 'M':
      case 'L':
        out.push(`${s.type}${fmt(s.x)} ${fmt(s.y)}`);
        break;
      case 'C':
        out.push(`C${fmt(s.x1)} ${fmt(s.y1)} ${fmt(s.x2)} ${fmt(s.y2)} ${fmt(s.x)} ${fmt(s.y)}`);
        break;
      case 'Q':
        out.push(`Q${fmt(s.x1)} ${fmt(s.y1)} ${fmt(s.x)} ${fmt(s.y)}`);
        break;
      case 'Z':
        out.push('Z');
    }
  }
  return out.join('');
}

const CMD_RE = /([MmLlHhVvCcSsQqTtAaZz])|([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/g;

/** Parse any SVG path `d` (all commands, relative/absolute, arcs) into normalised segments. */
export function parsePath(d: string): PathSegment[] {
  const tokens: (string | number)[] = [];
  let m: RegExpExecArray | null;
  CMD_RE.lastIndex = 0;
  while ((m = CMD_RE.exec(d))) tokens.push(m[1] ? m[1] : parseFloat(m[2]));
  const b = new PathBuilder();
  let i = 0;
  let cmd = '';
  let cx = 0, cy = 0, sx = 0, sy = 0;
  let lastCtrl: { x: number; y: number; kind: 'C' | 'Q' } | null = null;
  const num = () => {
    const v = tokens[i++];
    if (typeof v !== 'number') throw new Error(`Invalid path data near token ${i}: ${d.slice(0, 60)}`);
    return v;
  };
  while (i < tokens.length) {
    const t = tokens[i];
    if (typeof t === 'string') {
      cmd = t;
      i++;
      if (cmd === 'Z' || cmd === 'z') {
        b.close();
        cx = sx;
        cy = sy;
        lastCtrl = null;
        continue;
      }
    } else if (!cmd) {
      throw new Error('Path data must start with a command');
    }
    const rel = cmd === cmd.toLowerCase();
    const ox = rel ? cx : 0;
    const oy = rel ? cy : 0;
    switch (cmd.toUpperCase()) {
      case 'M': {
        cx = ox + num();
        cy = oy + num();
        sx = cx;
        sy = cy;
        b.moveTo(cx, cy);
        cmd = rel ? 'l' : 'L'; // subsequent pairs are implicit lineTo
        lastCtrl = null;
        break;
      }
      case 'L':
        cx = ox + num();
        cy = oy + num();
        b.lineTo(cx, cy);
        lastCtrl = null;
        break;
      case 'H':
        cx = (rel ? cx : 0) + num();
        b.lineTo(cx, cy);
        lastCtrl = null;
        break;
      case 'V':
        cy = (rel ? cy : 0) + num();
        b.lineTo(cx, cy);
        lastCtrl = null;
        break;
      case 'C': {
        const x1 = ox + num(), y1 = oy + num(), x2 = ox + num(), y2 = oy + num();
        cx = ox + num();
        cy = oy + num();
        b.cubicTo(x1, y1, x2, y2, cx, cy);
        lastCtrl = { x: x2, y: y2, kind: 'C' };
        break;
      }
      case 'S': {
        const x1: number = lastCtrl?.kind === 'C' ? 2 * cx - lastCtrl.x : cx;
        const y1: number = lastCtrl?.kind === 'C' ? 2 * cy - lastCtrl.y : cy;
        const x2 = ox + num(), y2 = oy + num();
        cx = ox + num();
        cy = oy + num();
        b.cubicTo(x1, y1, x2, y2, cx, cy);
        lastCtrl = { x: x2, y: y2, kind: 'C' };
        break;
      }
      case 'Q': {
        const x1 = ox + num(), y1 = oy + num();
        cx = ox + num();
        cy = oy + num();
        b.quadTo(x1, y1, cx, cy);
        lastCtrl = { x: x1, y: y1, kind: 'Q' };
        break;
      }
      case 'T': {
        const x1: number = lastCtrl?.kind === 'Q' ? 2 * cx - lastCtrl.x : cx;
        const y1: number = lastCtrl?.kind === 'Q' ? 2 * cy - lastCtrl.y : cy;
        cx = ox + num();
        cy = oy + num();
        b.quadTo(x1, y1, cx, cy);
        lastCtrl = { x: x1, y: y1, kind: 'Q' };
        break;
      }
      case 'A': {
        const rx = num(), ry = num(), rot = num(), large = num(), sweep = num();
        const x = ox + num(), y = oy + num();
        // Builder tracks the current point itself.
        (b as any).cx = cx;
        (b as any).cy = cy;
        b.arcTo(rx, ry, rot, !!large, !!sweep, x, y);
        cx = x;
        cy = y;
        lastCtrl = null;
        break;
      }
      default:
        throw new Error(`Unsupported path command ${cmd}`);
    }
  }
  return b.segments;
}

/** Convert an SVG arc to cubic Bézier control tuples [x1,y1,x2,y2,x,y]. */
export function arcToCubics(
  x0: number, y0: number, rx: number, ry: number, angleDeg: number,
  largeArc: boolean, sweep: boolean, x: number, y: number,
): number[][] {
  if (rx === 0 || ry === 0 || (x0 === x && y0 === y)) return [[x0, y0, x, y, x, y]];
  const phi = (angleDeg * Math.PI) / 180;
  const cosPhi = Math.cos(phi), sinPhi = Math.sin(phi);
  const dx = (x0 - x) / 2, dy = (y0 - y) / 2;
  const x1p = cosPhi * dx + sinPhi * dy;
  const y1p = -sinPhi * dx + cosPhi * dy;
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const sign = largeArc === sweep ? -1 : 1;
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const coef = sign * Math.sqrt(Math.max(0, num / den));
  const cxp = (coef * rx * y1p) / ry;
  const cyp = (-coef * ry * x1p) / rx;
  const cx = cosPhi * cxp - sinPhi * cyp + (x0 + x) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (y0 + y) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number) => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    return a;
  };
  const theta1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dTheta = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && dTheta > 0) dTheta -= 2 * Math.PI;
  if (sweep && dTheta < 0) dTheta += 2 * Math.PI;
  const segs = Math.ceil(Math.abs(dTheta) / (Math.PI / 2));
  const delta = dTheta / segs;
  const t = (4 / 3) * Math.tan(delta / 4);
  const out: number[][] = [];
  let th = theta1;
  for (let i = 0; i < segs; i++) {
    const c1 = Math.cos(th), s1 = Math.sin(th);
    const c2 = Math.cos(th + delta), s2 = Math.sin(th + delta);
    const p = (px: number, py: number) => [cosPhi * rx * px - sinPhi * ry * py + cx, sinPhi * rx * px + cosPhi * ry * py + cy];
    const [ax1, ay1] = p(c1 - t * s1, s1 + t * c1);
    const [ax2, ay2] = p(c2 + t * s2, s2 - t * c2);
    const [ex, ey] = p(c2, s2);
    out.push([ax1, ay1, ax2, ay2, ex, ey]);
    th += delta;
  }
  return out;
}

export function transformSegments(segments: PathSegment[], m: Matrix): PathSegment[] {
  const tp = (x: number, y: number) => applyToPoint(m, { x, y });
  return segments.map((s) => {
    switch (s.type) {
      case 'M':
      case 'L': {
        const p = tp(s.x, s.y);
        return { type: s.type, x: p.x, y: p.y };
      }
      case 'C': {
        const p1 = tp(s.x1, s.y1), p2 = tp(s.x2, s.y2), p = tp(s.x, s.y);
        return { type: 'C', x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, x: p.x, y: p.y };
      }
      case 'Q': {
        const p1 = tp(s.x1, s.y1), p = tp(s.x, s.y);
        return { type: 'Q', x1: p1.x, y1: p1.y, x: p.x, y: p.y };
      }
      default:
        return { type: 'Z' };
    }
  });
}

function cubicExtrema(p0: number, p1: number, p2: number, p3: number): number[] {
  // derivative: 3[(p1-p0)(1-t)^2 + 2(p2-p1)t(1-t) + (p3-p2)t^2]
  const a = -p0 + 3 * p1 - 3 * p2 + p3;
  const b = 2 * (p0 - 2 * p1 + p2);
  const c = p1 - p0;
  const ts: number[] = [];
  if (Math.abs(a) < 1e-12) {
    if (Math.abs(b) > 1e-12) ts.push(-c / b);
  } else {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const sq = Math.sqrt(disc);
      ts.push((-b + sq) / (2 * a), (-b - sq) / (2 * a));
    }
  }
  return ts.filter((t) => t > 0 && t < 1);
}

const cubicAt = (p0: number, p1: number, p2: number, p3: number, t: number) => {
  const mt = 1 - t;
  return mt * mt * mt * p0 + 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t * p3;
};

/** Tight bounding box including Bézier extrema. */
export function segmentsBounds(segments: PathSegment[]): Rect {
  const pts: Point[] = [];
  let cx = 0, cy = 0;
  for (const s of segments) {
    if (s.type === 'Z') continue;
    if (s.type === 'M' || s.type === 'L') pts.push({ x: s.x, y: s.y });
    else if (s.type === 'C') {
      pts.push({ x: s.x, y: s.y });
      for (const t of cubicExtrema(cx, s.x1, s.x2, s.x)) pts.push({ x: cubicAt(cx, s.x1, s.x2, s.x, t), y: cubicAt(cy, s.y1, s.y2, s.y, t) });
      for (const t of cubicExtrema(cy, s.y1, s.y2, s.y)) pts.push({ x: cubicAt(cx, s.x1, s.x2, s.x, t), y: cubicAt(cy, s.y1, s.y2, s.y, t) });
    } else if (s.type === 'Q') {
      // elevate to cubic
      const c1x = cx + (2 / 3) * (s.x1 - cx), c1y = cy + (2 / 3) * (s.y1 - cy);
      const c2x = s.x + (2 / 3) * (s.x1 - s.x), c2y = s.y + (2 / 3) * (s.y1 - s.y);
      pts.push({ x: s.x, y: s.y });
      for (const t of [...cubicExtrema(cx, c1x, c2x, s.x), ...cubicExtrema(cy, c1y, c2y, s.y)]) {
        pts.push({ x: cubicAt(cx, c1x, c2x, s.x, t), y: cubicAt(cy, c1y, c2y, s.y, t) });
      }
    }
    cx = s.x;
    cy = s.y;
  }
  return boundsOfPoints(pts);
}

export function pathBounds(d: string): Rect {
  return segmentsBounds(parsePath(d));
}

// ---------------------------------------------------------------------------------------
// Shape generators (all in a local box 0..w, 0..h)

export function rectPath(w: number, h: number, radius: number | [number, number, number, number] = 0): string {
  const [tl, tr, br, bl] = (Array.isArray(radius) ? radius : [radius, radius, radius, radius]).map((r) =>
    Math.max(0, Math.min(r, w / 2, h / 2)),
  );
  const k = 0.5522847498;
  const b = new PathBuilder().moveTo(tl, 0).lineTo(w - tr, 0);
  if (tr) b.cubicTo(w - tr + tr * k, 0, w, tr - tr * k, w, tr);
  b.lineTo(w, h - br);
  if (br) b.cubicTo(w, h - br + br * k, w - br + br * k, h, w - br, h);
  b.lineTo(bl, h);
  if (bl) b.cubicTo(bl - bl * k, h, 0, h - bl + bl * k, 0, h - bl);
  b.lineTo(0, tl);
  if (tl) b.cubicTo(0, tl - tl * k, tl - tl * k, 0, tl, 0);
  return b.close().toString();
}

export function ellipsePath(w: number, h: number): string {
  const rx = w / 2, ry = h / 2;
  const k = 0.5522847498;
  return new PathBuilder()
    .moveTo(w, ry)
    .cubicTo(w, ry + ry * k, rx + rx * k, h, rx, h)
    .cubicTo(rx - rx * k, h, 0, ry + ry * k, 0, ry)
    .cubicTo(0, ry - ry * k, rx - rx * k, 0, rx, 0)
    .cubicTo(rx + rx * k, 0, w, ry - ry * k, w, ry)
    .close()
    .toString();
}

export function polygonPath(w: number, h: number, sides: number, rotationDeg = 0): string {
  const b = new PathBuilder();
  const n = Math.max(3, Math.round(sides));
  for (let i = 0; i < n; i++) {
    const a = ((rotationDeg - 90 + (360 / n) * i) * Math.PI) / 180;
    const x = w / 2 + (w / 2) * Math.cos(a);
    const y = h / 2 + (h / 2) * Math.sin(a);
    i === 0 ? b.moveTo(x, y) : b.lineTo(x, y);
  }
  return b.close().toString();
}

export function starPath(w: number, h: number, points: number, innerRatio = 0.5, rotationDeg = 0): string {
  const b = new PathBuilder();
  const n = Math.max(2, Math.round(points)) * 2;
  for (let i = 0; i < n; i++) {
    const r = i % 2 === 0 ? 1 : innerRatio;
    const a = ((rotationDeg - 90 + (360 / n) * i) * Math.PI) / 180;
    const x = w / 2 + (w / 2) * r * Math.cos(a);
    const y = h / 2 + (h / 2) * r * Math.sin(a);
    i === 0 ? b.moveTo(x, y) : b.lineTo(x, y);
  }
  return b.close().toString();
}

export function linePath(points: Point[], closed = false): string {
  const b = new PathBuilder();
  points.forEach((p, i) => (i === 0 ? b.moveTo(p.x, p.y) : b.lineTo(p.x, p.y)));
  if (closed) b.close();
  return b.toString();
}

/** Scale a path from its own bounds into a target box (used for `path` shapes with a viewBox). */
export function fitPathToBox(d: string, w: number, h: number, viewBox?: [number, number, number, number]): string {
  const segs = parsePath(d);
  const vb = viewBox ?? (() => {
    const r = segmentsBounds(segs);
    return [r.x, r.y, r.width || 1, r.height || 1] as [number, number, number, number];
  })();
  const sx = w / (vb[2] || 1), sy = h / (vb[3] || 1);
  return segmentsToD(transformSegments(segs, [sx, 0, 0, sy, -vb[0] * sx, -vb[1] * sy]));
}
