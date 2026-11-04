/**
 * 2x3 affine matrix [a, b, c, d, e, f] mapping (x, y) → (a·x + c·y + e, b·x + d·y + f),
 * identical to SVG `matrix(a b c d e f)` and DOMMatrix 2D.
 */
export type Matrix = [number, number, number, number, number, number];

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

export function multiply(m1: Matrix, m2: Matrix): Matrix {
  const [a1, b1, c1, d1, e1, f1] = m1;
  const [a2, b2, c2, d2, e2, f2] = m2;
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ];
}

export function compose(...ms: Matrix[]): Matrix {
  return ms.reduce((acc, m) => multiply(acc, m), IDENTITY);
}

export const translate = (tx: number, ty: number): Matrix => [1, 0, 0, 1, tx, ty];
export const scale = (sx: number, sy = sx): Matrix => [sx, 0, 0, sy, 0, 0];
export function rotate(deg: number): Matrix {
  const r = (deg * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  return [cos, sin, -sin, cos, 0, 0];
}
export function skew(degX: number, degY: number): Matrix {
  return [1, Math.tan((degY * Math.PI) / 180), Math.tan((degX * Math.PI) / 180), 1, 0, 0];
}

export function invert(m: Matrix): Matrix {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-12) return [...IDENTITY];
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

export function applyToPoint(m: Matrix, p: Point): Point {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] };
}

export function isIdentity(m: Matrix, eps = 1e-9): boolean {
  return IDENTITY.every((v, i) => Math.abs(v - m[i]) < eps);
}

export function toSvgMatrix(m: Matrix): string {
  const r = (v: number) => +v.toFixed(6);
  return `matrix(${m.map(r).join(' ')})`;
}

export interface TransformLike {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  scaleX?: number;
  scaleY?: number;
  skewX?: number;
  skewY?: number;
  originX?: number;
  originY?: number;
  flipX?: boolean;
  flipY?: boolean;
}

/**
 * Local → parent matrix for a UDM transform: T(x,y)·T(o)·R·K·S·T(-o), where o is the
 * transform origin inside the box (fractions of width/height, default centre). This is the
 * classic T·R·S decomposition with skew and a pivot.
 */
export function transformToMatrix(t: TransformLike): Matrix {
  const ox = (t.originX ?? 0.5) * t.width;
  const oy = (t.originY ?? 0.5) * t.height;
  const sx = (t.scaleX ?? 1) * (t.flipX ? -1 : 1);
  const sy = (t.scaleY ?? 1) * (t.flipY ? -1 : 1);
  return compose(
    translate(t.x + ox, t.y + oy),
    rotate(t.rotation ?? 0),
    skew(t.skewX ?? 0, t.skewY ?? 0),
    scale(sx, sy),
    translate(-ox, -oy),
  );
}

/** Decompose an affine matrix into translate/rotate/scale/skewX (origin at 0,0). */
export function decompose(m: Matrix): { tx: number; ty: number; rotation: number; scaleX: number; scaleY: number; skewX: number } {
  const [a, b, c, d, e, f] = m;
  const scaleX = Math.hypot(a, b);
  const rotation = Math.atan2(b, a);
  const det = a * d - b * c;
  const scaleY = scaleX ? det / scaleX : 0;
  const skewX = Math.atan2(a * c + b * d, scaleX * scaleX);
  return { tx: e, ty: f, rotation: (rotation * 180) / Math.PI, scaleX, scaleY, skewX: (skewX * 180) / Math.PI };
}

export function rectCorners(r: Rect): Point[] {
  return [
    { x: r.x, y: r.y },
    { x: r.x + r.width, y: r.y },
    { x: r.x + r.width, y: r.y + r.height },
    { x: r.x, y: r.y + r.height },
  ];
}

export function boundsOfPoints(points: Point[]): Rect {
  if (!points.length) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function transformRect(m: Matrix, r: Rect): Rect {
  return boundsOfPoints(rectCorners(r).map((p) => applyToPoint(m, p)));
}

export function unionRects(rects: Rect[]): Rect {
  return boundsOfPoints(rects.flatMap(rectCorners));
}

export function rectContains(r: Rect, p: Point): boolean {
  return p.x >= r.x && p.y >= r.y && p.x <= r.x + r.width && p.y <= r.y + r.height;
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}
